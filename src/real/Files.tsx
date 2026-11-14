import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate, formatSize } from '../lib/data'
import { Badge, Button, Card, Empty, Field, PageTitle, SectionTitle, inputClass } from '../features/shared/ui'
import { useAuth } from './auth'
import { LoadError } from './Tasks'
import { FILE_LIMIT_BYTES, useDirectory, useSharedFiles, type SharedFile } from './data'

// The only kinds of file that can be shared, and how each is labelled when stored.
const KINDS: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
}
const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

const FILE_ERRORS: Record<string, string> = {
  file_not_allowed: 'Only spreadsheet files can be shared: .xlsx, .xls or .csv.',
  file_missing: 'The file did not upload. Please try again.',
  file_already_shared: 'This file was already shared.',
  file_not_found: 'That file is no longer there. Reload the page.',
}
const fileError = (message: string) => FILE_ERRORS[message] ?? 'Something went wrong. Please try again.'

/** A private download link that works for one hour. */
function useDownloadUrl(file: SharedFile) {
  return useQuery({
    queryKey: ['shared-url', file.storage_path],
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('shared').createSignedUrl(file.storage_path, 3600, { download: file.file_name })
      if (error) throw new Error(error.message)
      return data.signedUrl
    },
  })
}

export function FilesPage() {
  const { profile } = useAuth()
  const files = useSharedFiles()
  const directory = useDirectory()
  if (!profile) return null

  const isOwner = profile.role === 'admin'
  const all = files.data ?? []
  const nameOf = (id: string) =>
    id === profile.id ? 'You' : directory.data?.find((c) => c.id === id)?.full_name ?? 'Someone who has left'

  const approved = all.filter((f) => f.status === 'approved')
  const pending = all.filter((f) => f.status === 'pending')
  const refused = all.filter((f) => f.status === 'rejected')

  return (
    <>
      <PageTitle
        title="Shared files"
        subtitle={isOwner ? 'Spreadsheets everyone can see. You decide what gets shared.' : 'Spreadsheets everyone can see, once the owner has approved them.'}
      />

      {!profile.archived_at && <UploadForm isOwner={isOwner} />}

      {files.isError ? (
        <LoadError />
      ) : files.isLoading ? (
        <Empty>Loading…</Empty>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">{isOwner ? 'Waiting for your approval' : 'Your files waiting for approval'}</h2>
              {pending.map((f) => <FileRow key={f.id} file={f} uploader={nameOf(f.uploader_id)} isOwner={isOwner} />)}
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Shared with everyone</h2>
            {approved.length === 0 ? (
              <Empty>No shared files yet.</Empty>
            ) : (
              approved.map((f) => <FileRow key={f.id} file={f} uploader={nameOf(f.uploader_id)} isOwner={isOwner} />)
            )}
          </section>

          {refused.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">{isOwner ? 'Not shared' : 'Your files that were not shared'}</h2>
              {refused.map((f) => <FileRow key={f.id} file={f} uploader={nameOf(f.uploader_id)} isOwner={isOwner} />)}
            </section>
          )}
        </>
      )}
    </>
  )
}

function UploadForm({ isOwner }: { isOwner: boolean }) {
  const { profile } = useAuth()
  const client = useQueryClient()
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  if (!profile) return null

  const choose = (picked: File | null) => {
    setMessage(null)
    if (picked && !KINDS[extensionOf(picked.name)]) {
      setFile(null)
      setMessage({ ok: false, text: fileError('file_not_allowed') })
      return
    }
    if (picked && picked.size > FILE_LIMIT_BYTES) {
      setFile(null)
      setMessage({ ok: false, text: 'That file is too big. The limit is 10 MB.' })
      return
    }
    setFile(picked)
    if (picked && !title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, ''))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !title.trim()) {
      setMessage({ ok: false, text: 'Choose a spreadsheet and give it a name.' })
      return
    }
    setBusy(true)
    setMessage(null)
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    const path = `${profile.id}/${crypto.randomUUID()}-${safe}`
    const { error: uploadFailed } = await supabase.storage.from('shared').upload(path, file, { contentType: KINDS[extensionOf(file.name)] })
    if (uploadFailed) {
      setBusy(false)
      setMessage({ ok: false, text: fileError('file_missing') })
      return
    }
    const { error } = await supabase.rpc('share_file', { p_path: path, p_title: title.trim(), p_file_name: file.name })
    setBusy(false)
    if (error) {
      setMessage({ ok: false, text: fileError(error.message) })
      return
    }
    setTitle('')
    setFile(null)
    setMessage({ ok: true, text: isOwner ? 'Shared with everyone.' : 'Sent to the owner. Everyone will see it once it is approved.' })
    await client.invalidateQueries({ queryKey: ['shared-files'] })
  }

  return (
    <Card>
      <SectionTitle>Add a spreadsheet</SectionTitle>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="shared-file"
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium hover:bg-sunken focus-within:outline-2 focus-within:outline-accent"
          >
            <Upload size={16} />
            Choose a file
            <input
              id="shared-file"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(e) => {
                choose(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
          <span className="min-w-0 truncate text-sm text-muted" data-testid="chosen-file">
            {file ? `${file.name} · ${formatSize(file.size)}` : 'Excel (.xlsx, .xls) or .csv, up to 10 MB'}
          </span>
        </div>
        <Field label="Name to show in the list" htmlFor="shared-title">
          <input id="shared-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy}>{busy ? 'Uploading…' : isOwner ? 'Share with everyone' : 'Send for approval'}</Button>
          {message && (
            <span role={message.ok ? 'status' : 'alert'} className={`text-sm font-medium ${message.ok ? 'text-accent-strong' : 'text-danger'}`}>{message.text}</span>
          )}
        </div>
      </form>
    </Card>
  )
}

function FileRow({ file, uploader, isOwner }: { file: SharedFile; uploader: string; isOwner: boolean }) {
  const client = useQueryClient()
  const url = useDownloadUrl(file)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const review = async (approve: boolean) => {
    setBusy(true)
    setError('')
    const { error: failed } = await supabase.rpc('review_shared_file', { p_id: file.id, p_approve: approve, p_note: note })
    setBusy(false)
    setConfirming(false)
    if (failed) setError(fileError(failed.message))
    await client.invalidateQueries({ queryKey: ['shared-files'] })
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" data-testid="shared-file">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
          <FileSpreadsheet size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-sans font-semibold">{file.title}</h3>
          <p className="truncate text-sm text-muted">
            {uploader} · {formatDate(file.created_at)} · {file.file_name} · {formatSize(file.size_bytes)}
          </p>
        </div>
        {file.status === 'pending' && <Badge tone="warn">Waiting for approval</Badge>}
        {file.status === 'rejected' && <Badge tone="danger">Not shared</Badge>}
        <a
          href={url.data ?? undefined}
          aria-disabled={!url.data}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-sunken"
        >
          <Download size={15} />
          Download
        </a>
      </div>

      {file.review_note && file.status !== 'pending' && (
        <p className="rounded-lg bg-sunken px-3 py-2 text-sm">
          <span className="font-semibold">Note from the owner:</span> {file.review_note}
        </p>
      )}

      {isOwner && file.status === 'pending' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Download it and look inside before you approve. Once approved, everyone who has joined can download it.</p>
          <label htmlFor={`file-note-${file.id}`} className="text-sm font-medium">Note for the person (optional)</label>
          <input id={`file-note-${file.id}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          <div className="flex flex-wrap gap-2">
            <Button small disabled={busy} onClick={() => void review(true)}>Approve</Button>
            <Button small variant="secondary" disabled={busy} onClick={() => void review(false)}>Do not share</Button>
          </div>
        </div>
      )}

      {isOwner && file.status === 'approved' && (
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm">Stop sharing this file? Nobody but you and the person who added it will see it.</span>
              <Button small disabled={busy} onClick={() => void review(false)}>Yes, stop sharing</Button>
              <Button small variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep it</Button>
            </>
          ) : (
            <Button small variant="ghost" onClick={() => setConfirming(true)}>Stop sharing</Button>
          )}
        </div>
      )}

      {isOwner && file.status === 'rejected' && (
        <div>
          <Button small variant="secondary" disabled={busy} onClick={() => void review(true)}>Share it after all</Button>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </article>
  )
}
