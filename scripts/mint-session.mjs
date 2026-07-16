import { sealData } from 'iron-session'
import { readFileSync } from 'fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.replace(/\r$/, '').match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

const sealed = await sealData(
  { user: { id: 1, first_name: 'QA', last_name: 'Tester', email: 'qa@hitech.test', is_staff: true, is_superuser: true, role: 'admin' } },
  { password: process.env.SESSION_SECRET }
)
console.log(sealed)
