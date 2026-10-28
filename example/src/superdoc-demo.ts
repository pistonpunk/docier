import { createSuperDocView } from 'docier/superdoc'

const run = async (): Promise<void> => {
  const bytes = new Uint8Array(await (await fetch('/contract-template.docx')).arrayBuffer())
  const view = await createSuperDocView('#editor', { document: bytes })
  const listed = await view.listTokens()
  const missing = await view.fill({ surname: 'Ionescu', given_names: 'Maria', personal_number: '2001010543210' })
  const exported = await view.bytes()
  const w = window as unknown as { __result?: unknown }
  w.__result = { tokens: listed.length, missing, bytes: exported.length }
  console.log('SUPERDOC_DEMO', JSON.stringify(w.__result))
}

run().catch((error: unknown) => {
  console.log('SUPERDOC_DEMO_FAIL', String(error))
})
