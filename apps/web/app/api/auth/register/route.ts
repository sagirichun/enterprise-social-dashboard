import { NextRequest, NextResponse } from 'next/server';

/**
 * Public registration is disabled. This is a self-hosted single-admin
 * dashboard: the admin account already exists and no new accounts can be
 * created through the API. (Existing users and the database are untouched.)
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Registration is disabled on this server.' },
    { status: 403 },
  );
}
