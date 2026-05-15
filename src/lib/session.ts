import { SessionOptions } from 'iron-session'

export interface SessionUser {
  id: number
  first_name: string
  last_name: string
  email: string
  is_staff: boolean
  is_superuser: boolean
  role: 'admin' | 'worker'
}

export interface AppSession {
  user?: SessionUser
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: 'hitech-dashboard-session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  },
}
