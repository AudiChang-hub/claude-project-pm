/** One of the processes of the concurrent-write test: adds `count` items to the project at `repo`, one write each. */
import { resolveProject } from '../../src/project'
import { changeProject } from '../../src/store'

const [repo, name, count] = process.argv.slice(2)
const ref = await resolveProject(repo!)
if (!ref) throw new Error(`not a git repository: ${repo}`)
for (let i = 0; i < Number(count); i++) {
  await changeProject(ref, project => ({
    project: { ...project, nextId: project.nextId + 1, ledger: [...project.ledger, { id: project.nextId, text: `writer ${name} item ${i}`, owner: null, status: 'open', note: '', createdAt: i, updatedAt: i }] },
    result: null,
  }))
}
