'use client';
import { useState } from 'react';
import {
  Building2,
  UserPlus,
  Users,
  Search,
  Download,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Pencil,
} from 'lucide-react';
import {
  addressBookCsv,
  addressDetails,
  addressSearch,
  contactCompany,
  sortedContacts,
  type ContactSort,
} from '@/lib/address-book';
import {
  createEntity,
  day,
  type Entity,
  type FileMeta,
  type Scope,
} from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';
import { downloadBlob } from './calendar';
import { AddressPortrait } from './address-files';
export function AddressBook({
  records,
  files,
  store,
  scope,
  onOpen,
}: {
  records: Entity[];
  files: FileMeta[];
  store: LaunchStore;
  scope: Scope;
  onOpen: (entity: Entity, edit?: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sort, setSort] = useState<ContactSort>({ field: null, direction: 1 });
  const active = records.filter((e) => e.scope === scope && !e.deletedAt);
  const companies = active
    .filter((e) => e.kind === 'company')
    .map((e) => addressDetails(e, files))
    .sort((a, b) => a.title.localeCompare(b.title));
  const contacts = active
    .filter((e) => e.kind === 'contact')
    .map((e) => addressDetails(e, files));
  const members = new Map(
    companies.map((c) => [c.id, contacts.filter((p) => p.companyId === c.id)]),
  );
  const matches = companies.filter(
    (c) =>
      addressSearch(c, query) ||
      members.get(c.id)?.some((p) => addressSearch(p, query)),
  );
  const people = sortedContacts(
    contacts.filter(
      (p) =>
        addressSearch(p, query) ||
        contactCompany(p, companies)
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ),
    companies,
    sort,
  );
  const cycleSort = (field: ContactSort['field']) =>
    setSort((s) =>
      s.field !== field
        ? { field, direction: 1 }
        : s.direction === 1
          ? { field, direction: -1 }
          : { field: null, direction: 1 },
    );
  return (
    <section className="address-book" aria-label="Address book">
      <header className="address-book-header">
        <div>
          <p className="eyebrow">ADDRESS BOOK</p>
          <div className="address-heading">
            <h1>Contacts</h1>
            <button
              className="text-button"
              onClick={() => setShowAll(!showAll)}
              aria-expanded={showAll}
              aria-controls="all-address-contacts"
            >
              {showAll ? 'Hide all contacts' : 'View all contacts'}
              {showAll ? <ChevronUp /> : <ChevronDown />}
            </button>
          </div>
        </div>
        <label className="search">
          <Search />
          <input
            aria-label="Search companies and people"
            placeholder="Search companies and people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="address-header-actions">
          <button
            className="button"
            onClick={() =>
              downloadBlob(
                new Blob([addressBookCsv(companies, contacts)], {
                  type: 'text/csv;charset=utf-8',
                }),
                `contacts-export-${day()}.csv`,
              )
            }
          >
            <Download />
            Export
          </button>
          <button
            className="button address-add-contact"
            onClick={() => onOpen(createEntity('contact', scope), true)}
          >
            <UserPlus />
            Add Contact
          </button>
          <button
            className="button primary"
            onClick={() => onOpen(createEntity('company', scope), true)}
          >
            <Building2 />
            Add Company
          </button>
        </div>
      </header>
      <div className="address-book-body">
        <div className="address-company-grid">
          {matches.map((company) => {
            const group = members.get(company.id) || [];
            const primary = group.find((p) => p.id === company.primaryId);
            return (
              <button
                className="address-company-card"
                key={company.id}
                onClick={() => onOpen(company)}
              >
                <div className="address-company-main">
                  <AddressPortrait
                    entity={company}
                    store={store}
                    files={files}
                  />
                  <div>
                    <h2 title={company.title}>{company.title}</h2>
                    <small>
                      <Users />
                      {group.length}{' '}
                      {group.length === 1 ? 'contact' : 'contacts'}
                    </small>
                  </div>
                </div>
                <div className="address-company-primary">
                  <span>CONTACT:</span>
                  <span title={primary?.title}>{primary?.title || '—'}</span>
                </div>
              </button>
            );
          })}
        </div>
        {!matches.length && (
          <p className="address-empty">
            {companies.length
              ? 'No companies match your search.'
              : 'No companies yet. Add a company to keep its contacts and files together.'}
          </p>
        )}
        {showAll && (
          <section id="all-address-contacts" className="address-all-contacts">
            <h2>All Contacts ({contacts.length})</h2>
            {!people.length ? (
              <p className="address-empty">
                {contacts.length
                  ? 'No contacts match your search.'
                  : 'No contacts yet. Add one with the Add Contact button above.'}
              </p>
            ) : (
              <div className="address-table-scroll">
                <table className="address-table">
                  <thead>
                    <tr>
                      {(
                        [
                          ['title', 'Name'],
                          ['email', 'Email'],
                          ['company', 'Company'],
                        ] as const
                      ).map(([field, label]) => (
                        <th
                          key={field}
                          aria-sort={
                            sort.field === field
                              ? sort.direction === 1
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                          }
                        >
                          <button onClick={() => cycleSort(field)}>
                            {label}
                            {sort.field === field ? (
                              sort.direction === 1 ? (
                                <ChevronUp />
                              ) : (
                                <ChevronDown />
                              )
                            ) : (
                              <ChevronsUpDown />
                            )}
                          </button>
                        </th>
                      ))}
                      <th>
                        <span className="sr-only">Edit</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => (
                      <tr key={person.id}>
                        <td>
                          <button
                            className="address-person-name"
                            onClick={() => onOpen(person)}
                          >
                            <AddressPortrait
                              entity={person}
                              store={store}
                              files={files}
                            />
                            <span>
                              {person.title}
                              {person.jobTitle && (
                                <small>{person.jobTitle}</small>
                              )}
                            </span>
                          </button>
                        </td>
                        <td>
                          {person.email ? (
                            <a
                              href={`mailto:${encodeURIComponent(person.email)}`}
                            >
                              {person.email}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {companies.some((c) => c.id === person.companyId) ? (
                            <button
                              className="address-company-link"
                              onClick={() =>
                                onOpen(
                                  companies.find(
                                    (c) => c.id === person.companyId,
                                  )!,
                                )
                              }
                            >
                              {contactCompany(person, companies)}
                            </button>
                          ) : (
                            contactCompany(person, companies) || (
                              <span className="hint">Unassigned</span>
                            )
                          )}
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Edit ${person.title}`}
                            onClick={() => onOpen(person, true)}
                          >
                            <Pencil />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
