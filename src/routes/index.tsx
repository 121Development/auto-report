import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { createDocument, listDocuments } from '../server/documents'

export const Route = createFileRoute('/')({
  loader: () => listDocuments(),
  component: Home,
})

const dateFormat = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })

function Home() {
  const docs = Route.useLoaderData()
  const create = useServerFn(createDocument)
  const navigate = useNavigate()

  async function newDocument() {
    const { id } = await create({ data: {} })
    await navigate({ to: '/doc/$id', params: { id } })
  }

  return (
    <main className="home">
      <header className="home-header">
        <h1>Documents</h1>
        <button type="button" className="primary" onClick={newDocument}>
          New document
        </button>
      </header>
      {docs.length === 0 ? (
        <p className="muted">No documents yet.</p>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <Link to="/doc/$id" params={{ id: d.id }}>
                {d.title || 'Untitled'}
              </Link>
              <time className="muted" suppressHydrationWarning>{dateFormat.format(d.updatedAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
