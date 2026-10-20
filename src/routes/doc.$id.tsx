import { createFileRoute, notFound } from '@tanstack/react-router'
import { Editor } from '../editor/Editor'
import { getDocument } from '../server/documents'

export const Route = createFileRoute('/doc/$id')({
  loader: async ({ params }) => {
    const doc = await getDocument({ data: params.id })
    if (!doc) throw notFound()
    return doc
  },
  // Always load fresh: autosave changes the document behind the router's cache.
  staleTime: 0,
  gcTime: 0,
  component: DocPage,
  notFoundComponent: () => <main className="home">Document not found.</main>,
})

function DocPage() {
  const doc = Route.useLoaderData()
  return <Editor key={doc.id} doc={doc} />
}
