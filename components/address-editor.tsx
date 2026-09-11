'use client';
import { useRef, useState, type ReactNode } from 'react';
import {
  Building2,
  Mail,
  Phone,
  Globe,
  MapPin,
  Pencil,
  Trash2,
  Plus,
  Star,
  ExternalLink,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { AddressFiles, AddressPortrait } from './address-files';
import {
  addressDetails,
  cleanEmail,
  cleanPhone,
  contactCompany,
  sortedContacts,
  websiteUrl,
} from '@/lib/address-book';
import { createEntity, type Entity, type FileMeta } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

type Props = {
  entity: Entity;
  initialEdit?: boolean;
  store: LaunchStore;
  records: Entity[];
  files: FileMeta[];
  onClose: () => void;
  onDelete: (entity: Entity) => Promise<void>;
  notify: (text: string) => void;
  parentCompany?: Entity;
};
export function AddressEditor({
  entity,
  initialEdit,
  store,
  records,
  files,
  onClose,
  onDelete,
  notify,
  parentCompany,
}: Props) {
  const current = records.find((e) => e.id === entity.id) || entity;
  const exists = records.some((e) => e.id === entity.id);
  const [editing, setEditing] = useState(initialEdit || !exists);
  const [draft, setDraft] = useState(() => addressDetails(current, files));
  const base = useRef(current);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [child, setChild] = useState<Entity | null>(null);
  const [expanded, setExpanded] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const portraitPending = useRef(false);
  const disabled = busy || fileBusy || photoBusy;
  const company = entity.kind === 'company';
  const shown = editing ? draft : addressDetails(current, files);
  const companies = records
    .filter(
      (e) => e.kind === 'company' && !e.deletedAt && e.scope === entity.scope,
    )
    .sort((a, b) => a.title.localeCompare(b.title));
  const contacts = sortedContacts(
    records
      .filter(
        (e) =>
          e.kind === 'contact' &&
          !e.deletedAt &&
          e.scope === entity.scope &&
          e.companyId === entity.id,
      )
      .map((e) => addressDetails(e, files)),
    companies,
    { field: null, direction: 1 },
  );
  function change(patch: Partial<Entity>) {
    setDraft((d) => ({ ...d, ...patch }));
  }
  function edit() {
    base.current = current;
    setDraft(addressDetails(current, files));
    setEditing(true);
  }
  function cancel() {
    if (exists) {
      setEditing(false);
      setDraft(addressDetails(current, files));
    } else onClose();
  }
  async function save() {
    if (disabled || working.current) return;
    const details = {
      ...draft,
      email: cleanEmail(draft.email || ''),
      phone: cleanPhone(draft.phone || ''),
    };
    details.title = company
      ? draft.title.trim()
      : [draft.firstName?.trim(), draft.lastName?.trim()]
          .filter(Boolean)
          .join(' ') ||
        details.email ||
        draft.companyName?.trim() ||
        companies.find((c) => c.id === draft.companyId)?.title ||
        '';
    if (!details.title) {
      notify(
        company ? 'Enter a company name.' : 'Enter a contact name or email.',
      );
      return;
    }
    if (details.website && !websiteUrl(details.website)) {
      notify('Enter a valid website address.');
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      if (exists) {
        const patch = Object.fromEntries(
          Object.entries(details).filter(
            ([key, value]) =>
              !['version', 'createdAt', 'updatedAt'].includes(key) &&
              JSON.stringify(base.current[key as keyof Entity]) !==
                JSON.stringify(value),
          ),
        );
        await store.change(base.current, patch);
      } else await store.add(details);
      notify(company ? 'Company saved.' : 'Contact saved.');
      if (exists) setEditing(false);
      else onClose();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (disabled || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      await onDelete(current);
      onClose();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function setPortrait(file?: File) {
    if (!file || disabled || portraitPending.current) return;
    if (!file.type.startsWith('image/')) {
      notify(
        'Choose an image for the ' + (company ? 'logo.' : 'contact photo.'),
      );
      return;
    }
    portraitPending.current = true;
    setPhotoBusy(true);
    try {
      const [id] = await store.addFiles([file]);
      setDraft((d) => ({
        ...d,
        portraitId: id,
        files: [...d.files.filter((f) => f !== d.portraitId), id],
        fileLabels: Object.fromEntries(
          Object.entries(d.fileLabels || {}).filter(
            ([key]) => key !== d.portraitId,
          ),
        ),
      }));
    } catch (error) {
      notify((error as Error).message);
    } finally {
      portraitPending.current = false;
      setPhotoBusy(false);
    }
  }
  async function primary(person: Entity) {
    if (disabled || working.current) return;
    const primaryId = shown.primaryId === person.id ? '' : person.id;
    if (editing) {
      change({ primaryId });
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      await store.change(current, { primaryId });
    } catch (error) {
      notify((error as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const companyName = contactCompany(shown, companies);
  const fields = (
    label: string,
    key:
      | 'title'
      | 'firstName'
      | 'lastName'
      | 'jobTitle'
      | 'companyName'
      | 'email'
      | 'phone'
      | 'website'
      | 'address',
    placeholder = '',
    type = 'text',
  ) => (
    <label className="address-field">
      <span>{label}</span>
      <input
        type={type}
        value={draft[key] || ''}
        maxLength={key === 'title' ? 500 : 2000}
        placeholder={placeholder}
        onChange={(event) => change({ [key]: event.target.value })}
      />
    </label>
  );
  const companyContacts =
    company && exists ? (
      <section className="address-company-contacts">
        <div className="address-section-heading">
          <h2>Contacts ({contacts.length})</h2>
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() =>
              setChild(
                createEntity('contact', entity.scope, {
                  companyId: entity.id,
                  companyName: shown.title,
                }),
              )
            }
          >
            <Plus />
            Add
          </button>
        </div>
        {!contacts.length ? (
          <p className="hint">No contacts yet.</p>
        ) : (
          <ul>
            {contacts.map((person) => (
              <li key={person.id}>
                <AddressPortrait entity={person} store={store} files={files} />
                <div>
                  <button
                    type="button"
                    className="address-person-link"
                    onClick={() => setChild(person)}
                  >
                    {person.title}
                  </button>
                  {person.jobTitle && <small>{person.jobTitle}</small>}
                  {person.email && (
                    <a href={`mailto:${encodeURIComponent(person.email)}`}>
                      <Mail />
                      {person.email}
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  className={
                    'icon-button address-primary-star ' +
                    (shown.primaryId === person.id ? 'selected' : '')
                  }
                  disabled={disabled}
                  aria-pressed={shown.primaryId === person.id}
                  aria-label={`${shown.primaryId === person.id ? 'Remove primary designation from' : 'Make primary contact:'} ${person.title}`}
                  title={
                    shown.primaryId === person.id
                      ? 'Primary contact — click to remove'
                      : 'Make primary contact'
                  }
                  onClick={() => void primary(person)}
                >
                  <Star />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    ) : null;
  const attachments = (
    <AddressFiles
      entity={shown}
      store={store}
      files={files}
      editing={!!editing}
      disabled={busy || photoBusy}
      onChange={change}
      onBusy={setFileBusy}
      notify={notify}
    />
  );
  return (
    <Dialog open onOpenChange={(open) => !open && !disabled && onClose()}>
      <DialogContent
        className="address-dialog"
        onKeyDown={(event) => {
          if (
            editing &&
            (event.metaKey || event.ctrlKey) &&
            event.key === 'Enter'
          ) {
            event.preventDefault();
            void save();
          }
        }}
      >
        <header className="address-dialog-header">
          <DialogTitle>
            {!exists
              ? company
                ? 'New company'
                : 'New contact'
              : current.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {company
              ? 'Company details and contacts'
              : 'Individual contact details'}
          </DialogDescription>
        </header>
        <form
          className="address-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (editing) void save();
          }}
        >
          <div className="address-dialog-body">
            {editing ? (
              <fieldset disabled={disabled} className="address-edit-fields">
                <div className="address-edit-identity">
                  <div className="address-photo-picker">
                    <button
                      type="button"
                      aria-label={`Upload ${company ? 'company logo' : 'contact photo'}: click, paste, or drop an image`}
                      title="Click to upload — or paste an image (⌘V)"
                      onClick={() => picker.current?.click()}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        void setPortrait(event.dataTransfer.files[0]);
                      }}
                      onPaste={(event) => {
                        if (event.clipboardData.files.length) {
                          event.preventDefault();
                          void setPortrait(event.clipboardData.files[0]);
                        }
                      }}
                    >
                      <AddressPortrait
                        entity={draft}
                        store={store}
                        files={files}
                      />
                    </button>
                    {draft.portraitId && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          change({
                            portraitId: '',
                            files: draft.files.filter(
                              (id) => id !== draft.portraitId,
                            ),
                            fileLabels: Object.fromEntries(
                              Object.entries(draft.fileLabels || {}).filter(
                                ([key]) => key !== draft.portraitId,
                              ),
                            ),
                          })
                        }
                      >
                        <Trash2 />
                        Remove {company ? 'logo' : 'photo'}
                      </button>
                    )}
                    <input
                      ref={picker}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        void setPortrait(event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </div>
                  {company ? (
                    fields('Company name', 'title', 'Company name')
                  ) : (
                    <div className="address-two-col">
                      {fields('First name', 'firstName', 'First name')}
                      {fields('Last name', 'lastName', 'Last name')}
                    </div>
                  )}
                </div>
                {company ? (
                  <>
                    <div className="address-two-col">
                      {fields('Email', 'email', 'email@example.com', 'email')}
                      <div className="address-website-field">
                        {fields('Website', 'website', 'www.example.com')}
                        {websiteUrl(draft.website || '') && (
                          <a
                            href={websiteUrl(draft.website || '')}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open website"
                          >
                            <ExternalLink />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="address-two-col">
                      {fields(
                        'Address',
                        'address',
                        'Street address, city, state, zip',
                      )}
                      {fields('Phone', 'phone', '(555) 123-4567', 'tel')}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="address-two-col">
                      {fields('Title', 'jobTitle', 'Job title')}
                      <label className="address-field">
                        <span>Company</span>
                        <select
                          value={draft.companyId || ''}
                          disabled={!!parentCompany && !exists}
                          onChange={(event) =>
                            change({
                              companyId: event.target.value,
                              companyName:
                                companies.find(
                                  (c) => c.id === event.target.value,
                                )?.title ||
                                draft.companyName ||
                                '',
                            })
                          }
                        >
                          <option value="">— No company —</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {!draft.companyId &&
                      fields(
                        'Company name (free text)',
                        'companyName',
                        'Company name',
                      )}
                    <div className="address-two-col">
                      {fields('Email', 'email', 'email@example.com', 'email')}
                      {fields('Phone', 'phone', '(555) 123-4567', 'tel')}
                    </div>
                  </>
                )}
                <label className="address-field">
                  <span>Notes</span>
                  <textarea
                    value={draft.notes}
                    rows={3}
                    placeholder="Additional notes..."
                    onChange={(event) => change({ notes: event.target.value })}
                  />
                </label>
              </fieldset>
            ) : (
              <section className="address-profile">
                <AddressPortrait entity={shown} store={store} files={files} />
                {!company && shown.jobTitle && <p>{shown.jobTitle}</p>}
                <div className="address-profile-links">
                  {!company && companyName && (
                    <ProfileLink
                      icon={<Building2 />}
                      text={companyName}
                      onClick={
                        shown.companyId &&
                        companies.some((c) => c.id === shown.companyId)
                          ? () => {
                              if (parentCompany?.id === shown.companyId)
                                onClose();
                              else
                                setChild(
                                  companies.find(
                                    (c) => c.id === shown.companyId,
                                  )!,
                                );
                            }
                          : undefined
                      }
                    />
                  )}
                  {shown.email && (
                    <ProfileLink
                      icon={<Mail />}
                      text={shown.email}
                      href={`mailto:${encodeURIComponent(shown.email)}`}
                    />
                  )}
                  {company && shown.website && (
                    <ProfileLink
                      icon={<Globe />}
                      text={shown.website}
                      href={websiteUrl(shown.website)}
                      external
                    />
                  )}
                  {company && shown.address && (
                    <ProfileLink icon={<MapPin />} text={shown.address} />
                  )}
                  {shown.phone && (
                    <ProfileLink
                      icon={<Phone />}
                      text={shown.phone}
                      href={`tel:${encodeURIComponent(shown.phone)}`}
                    />
                  )}
                </div>
                {shown.notes && (
                  <div className="address-profile-notes">
                    <p>
                      {!expanded && shown.notes.length > 300
                        ? shown.notes.slice(0, 300) + '…'
                        : shown.notes}
                    </p>
                    {shown.notes.length > 300 && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setExpanded(!expanded)}
                      >
                        {expanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}
            {editing ? (
              <>
                {companyContacts}
                {attachments}
              </>
            ) : (
              <>
                {attachments}
                {companyContacts}
              </>
            )}
          </div>
          <footer className="address-dialog-footer">
            {exists && (
              <button
                type="button"
                className="text-button address-delete"
                disabled={disabled}
                onClick={() => void remove()}
              >
                <Trash2 />
                {editing
                  ? `Delete ${company ? 'company' : 'contact'}`
                  : 'Delete'}
              </button>
            )}
            <div className="address-footer-right">
              <button
                type="button"
                className="button"
                disabled={disabled}
                onClick={editing ? cancel : onClose}
              >
                {editing ? 'Cancel' : 'Close'}
              </button>
              {editing ? (
                <button
                  className="button primary"
                  type="submit"
                  disabled={disabled}
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              ) : (
                <button type="button" className="button primary" onClick={edit}>
                  <Pencil />
                  Edit
                </button>
              )}
            </div>
          </footer>
        </form>
        {child && (
          <AddressEditor
            key={child.id}
            entity={child}
            store={store}
            records={records}
            files={files}
            parentCompany={company ? shown : undefined}
            onClose={() => setChild(null)}
            onDelete={onDelete}
            notify={notify}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function ProfileLink({
  icon,
  text,
  href,
  external,
  onClick,
}: {
  icon: ReactNode;
  text: string;
  href?: string;
  external?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon}
      <span>{text}</span>
    </>
  );
  return href ? (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
    >
      {content}
    </a>
  ) : onClick ? (
    <button type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <span>{content}</span>
  );
}
