import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { SectionId } from './section-id'

/** Schema-defining extensions, shared by the editor UI and tests. */
export const baseExtensions = [StarterKit, Markdown, SectionId]
