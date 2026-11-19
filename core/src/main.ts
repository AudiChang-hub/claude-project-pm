/** The program's entry: every command, then exit with its code (an MCP server or `serve` keeps running until closed). */
import { main } from './cli'
import './commands'

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code
  },
  err => {
    process.stderr.write(`project-pm: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    process.exitCode = 1
  },
)
