import { NextResponse, type NextRequest } from 'next/server';
import { openApiDocument } from '@/lib/api/openapi';

/** GET /api/v1/openapi.json — machine-readable API description (OpenAPI 3.1). */
export function GET(req: NextRequest) {
  return NextResponse.json(openApiDocument(req.nextUrl.origin));
}
