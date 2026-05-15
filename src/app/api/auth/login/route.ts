import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { pbkdf2, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { sessionOptions, AppSession } from '@/lib/session'

const pbkdf2Async = promisify(pbkdf2)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function verifyDjangoPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false
  const iterations = parseInt(parts[1], 10)
  const salt = parts[2]
  const storedHash = Buffer.from(parts[3], 'base64')
  const derived = await pbkdf2Async(password, salt, iterations, storedHash.length, 'sha256')
  return timingSafeEqual(derived, storedHash)
}

export async function POST(req: NextRequest) {
  const { identifier, password } = await req.json()

  if (!identifier || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  const { data: user, error } = await supabase
    .from('auth_user')
    .select('id, first_name, last_name, email, password, is_staff, is_superuser, is_active')
    .ilike('email', identifier)
    .single()

  if (error || !user) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 })
  }

  if (!user.is_active) {
    return NextResponse.json({ error: 'Account is disabled.' }, { status: 401 })
  }

  const valid = await verifyDjangoPassword(password, user.password)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 })
  }

  const role: 'admin' | 'worker' = (user.is_staff || user.is_superuser) ? 'admin' : 'worker'

  const res = NextResponse.json({ ok: true })
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  session.user = {
    id: user.id,
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: user.email,
    is_staff: user.is_staff,
    is_superuser: user.is_superuser,
    role,
  }
  await session.save()
  return res
}
