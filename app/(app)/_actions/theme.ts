'use server';

import { cookies } from 'next/headers';

export async function setTheme(next: 'orbit' | 'light'): Promise<void> {
  cookies().set({
    name: 'orbit',
    value: next === 'orbit' ? '1' : '0',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    httpOnly: false,
    sameSite: 'lax',
  });
}
