"""Read-only Mission Control → Launch backup converter. Never writes the source DB.

Usage: python3 scripts/import-mission-control.py SOURCE_DB OUTPUT_DIRECTORY
Private data stays in the output directory, never in application source.
"""
import collections
import datetime as dt
import hashlib
import json
import mimetypes
import pathlib
import sqlite3
import sys
import zipfile


def convert(source, output):
    source, output = pathlib.Path(source).resolve(), pathlib.Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).isoformat()
    today = dt.date.today().isoformat()
    db = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
    snapshot = output / 'mission-control-original.db'
    if snapshot.exists():
        raise ValueError('Choose a new output directory; the source snapshot already exists.')
    with sqlite3.connect(snapshot) as dest:
        db.backup(dest)  # Includes committed WAL data, unlike copying tasks.db alone.
    db.close()
    db = sqlite3.connect(snapshot.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}

    def rows(table):
        return [dict(r) for r in db.execute('select * from "' + table + '"')] if table in tables else []

    data = {t: rows(t) for t in tables if not t.startswith(('sqlite_', 'attachment_text'))}
    file_root = source.parent / 'files'
    paths = [p for p in file_root.rglob('*') if p.is_file()]
    records, files, file_paths, missing, adjustments = [], {}, {}, [], []

    def eid(table, id):
        return 'mc-' + table + '-' + str(id)

    def add(kind, table, r, title, scope='business', **extra):
        e = dict(id=eid(table, r['id']), kind=kind, title=(title or 'Imported item')[:500],
                 notes=r.get('notes') or '', scope=scope, report=False, files=[],
                 createdAt=r.get('created_at') or stamp, updatedAt=r.get('updated_at') or r.get('created_at') or stamp,
                 status='active', order=r.get('manual_order') if r.get('manual_order') is not None else r.get('sort_order', 0),
                 legacy={'source': 'mission-control', 'table': table, 'record': r}, **extra)
        records.append(e)
        return e

    def attach(e, r, field='relative_path'):
        relative = r.get(field)
        if not relative:
            return
        candidates = [p for p in paths if p.name == pathlib.Path(relative).name]
        if len(candidates) != 1:
            missing.append(dict(record=e['id'], file=relative))
            return
        path = candidates[0]
        if not path.resolve().is_relative_to(file_root.resolve()):
            raise ValueError('Attachment resolves outside the source files directory')
        id = 'mc-file-' + hashlib.sha256(relative.encode()).hexdigest()[:32]
        name = r.get('file_name') or path.name
        files[id] = dict(id=id, name=name, type=r.get('mime_type') or mimetypes.guess_type(name)[0] or 'application/octet-stream',
                         size=path.stat().st_size, createdAt=r.get('created_at') or stamp)
        file_paths[id] = path
        if id not in e['files']:
            e['files'].append(id)

    task_rows = data['tasks']
    roots = {r['id']: r for r in task_rows if r['repeat'] != 'none'}
    campaign_names = {c['id']: c['name'] for c in data.get('campaigns', [])}
    for r in task_rows:
        internal = r['task_name'].strip().lower() in {'respond to reviews', 'enter doordash & ubereats transactions'}
        scope = 'personal' if r['is_personal'] and not internal else 'business'
        e = add('task', 'tasks', r, r['task_name'], scope)
        done = r['status'] == 'final_delivered'
        e.update(status='completed' if done else 'active', draft=r['draft_due'] or '', final=r['final_due'] or '',
                 draftDone=bool(r['draft_completed_at']) or done, finalDone=done,
                 completedAt=r['delivered_at'] or r['approved_at'] or '' if done else '',
                 important=bool(r['is_important'] or r['is_pinned']),
                 report=bool(r['include_in_report']) and scope == 'business' and not internal,
                 companyId=eid('companies', r['assigned_company_id']) if r['assigned_company_id'] else '',
                 contactId=eid('contacts', r['assigned_contact_id']) if r['assigned_contact_id'] else '', repeat='none')
        if done and not e['completedAt']:
            adjustments.append(dict(record=e['id'], reason='Completion date unavailable; preserved without inventing one'))
        if internal and r['is_personal']:
            adjustments.append(dict(record=e['id'], reason='Business routine; report disabled instead of personal'))
        root = roots.get(r['recurring_parent_id'] or r['id'])
        if root:
            anchor = root['draft_due'] or root['final_due']
            config = json.loads(root['repeat_config'] or '{}')
            e.update(seriesId=eid('tasks', root['id']), occurrence=r['draft_due'] or r['final_due'] or '',
                     repeatAnchor=anchor, repeat=root['repeat'], repeatDays=[config.get('dayOfWeek', dt.date.fromisoformat(anchor).isoweekday() % 7)],
                     repeatFrom=today, repeatUntil=root.get('repeat_until') or '', excludedDates=json.loads(root.get('excluded_dates') or '[]'))
        e['legacy']['campaigns'] = [campaign_names[x['campaign_id']] for x in data.get('task_campaigns', []) if x['task_id'] == r['id']]

    for r in data.get('companies', []):
        e = add('company', 'companies', r, r['name'])
        e.update(email=r['email'] or '', phone=r['phone'] or '', primaryId=eid('contacts', r['primary_contact_id']) if r['primary_contact_id'] else '')
        extra = [f"Website: {r['website']}" if r['website'] else '', f"Address: {r['address']}" if r['address'] else '']
        e['notes'] = '\n'.join(x for x in [e['notes'], *extra] if x)
        attach(e, r, 'logo_path')
    for r in data.get('contacts', []):
        e = add('contact', 'contacts', r, ' '.join(x for x in [r['first_name'], r['last_name']] if x) or r['email'])
        e.update(email=r['email'] or '', phone=r['phone'] or '', companyId=eid('companies', r['company_id']) if r['company_id'] else '')
        if r.get('title'):
            e['notes'] = '\n'.join(x for x in [r['title'], e['notes']] if x)
        attach(e, r, 'avatar_path')
    for r in data.get('calendar_events', []):
        e = add('event', 'calendar_events', r, r['name'])
        e.update(date=r['start_date'], endDate=r['end_date'], time=r['start_time'] or '', endTime=r['end_time'] or '', report=True)
    for r in data.get('scratch_pad_items', []):
        add('note', 'scratch_pad_items', r, r['text'], 'personal', archived=bool(r['is_complete']))
    for r in data.get('agenda_items', []):
        e = add('agenda', 'agenda_items', r, r['text'])
        e.update(report=True, archived=bool(r['is_discussed']), important=bool(r['is_important']),
                 status='completed' if r['is_discussed'] else 'active', date=(r['discussed_at'] or '')[:10])
    for r in data.get('reference_files', []):
        e = add('reference', 'reference_files', r, r.get('display_name') or r['file_name'])
        attach(e, r)
    # Already-routed Telegram captures stay archived instead of becoming duplicate active tasks.
    for r in data.get('telegram_captures', []):
        text = r['proposed_text'] or r['raw_text'] or 'Imported capture'
        e = add('note', 'telegram_captures', r, text.split('\n')[0], 'personal', archived=bool(r['routed_to']))
        e['notes'] = text
        attach(e, {**r, 'relative_path': r.get('photo_relative_path'), 'file_name': r.get('photo_file_name'), 'mime_type': r.get('photo_mime_type')})
        attach(e, {**r, 'relative_path': r.get('audio_file')})
    for r in data.get('task_templates', []):
        e = add('note', 'task_templates', r, 'Task template · ' + r['name'], archived=True)
        e['notes'] = '\n'.join(x for x in [r['task_name'], r['notes'], 'Repeat: ' + r['repeat']] if x)
    setting = add('settings', 'settings', {'id': 'imported-preferences'}, 'Launch preferences')
    setting['monthlyNotes'] = {r['month_key']: r['notes'] for r in data.get('monthly_notes', [])}
    setting['businessName'] = 'Colorado Mountain Brewery'
    index = {e['id']: e for e in records}
    for table, target, foreign in [
        ('task_attachments', 'tasks', 'task_id'), ('company_attachments', 'companies', 'company_id'),
        ('contact_attachments', 'contacts', 'contact_id'), ('agenda_attachments', 'agenda_items', 'agenda_id'),
        ('scratch_pad_attachments', 'scratch_pad_items', 'item_id'), ('calendar_event_attachments', 'calendar_events', 'event_id')]:
        for r in data.get(table, []):
            e = index.get(eid(target, r[foreign]))
            if not e:
                raise ValueError('Attachment parent missing: ' + r['id'])
            attach(e, r)
    if missing:
        (output / 'missing-files.json').write_text(json.dumps(missing, indent=2))
        raise ValueError(f'{len(missing)} attachments missing; resolve before import')
    if any(f['size'] > 20 * 1024 * 1024 for f in files.values()):
        raise ValueError('Attachment exceeds Launch upload limit')
    # Import recurring roots last so a concurrent sync cannot materialize duplicates
    # while existing child occurrences are still uploading in earlier batches.
    records.sort(key=lambda e: bool(e.get('seriesId') == e['id']))
    backup = dict(format='launch-v1', createdAt=stamp, records=records, files=list(files.values()))
    (output / 'launch-backup.json').write_text(json.dumps(backup, indent=2))
    with zipfile.ZipFile(output / 'Launch-Mission-Control-import.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('launch-backup.json', json.dumps(backup))
        for id, path in file_paths.items():
            z.write(path, 'files/' + id)
    summary = dict(records=len(records), kinds=dict(collections.Counter(e['kind'] for e in records)),
                   tasksCompleted=sum(e['kind'] == 'task' and e['status'] == 'completed' for e in records),
                   files=len(files), bytes=sum(f['size'] for f in files.values()), missingFiles=missing,
                   adjustments=adjustments, sourceCounts={k: len(v) for k, v in data.items()})
    (output / 'migration-summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: v for k, v in summary.items() if k not in ('adjustments', 'sourceCounts')}, indent=2))
    db.close()


if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2])
