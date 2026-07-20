import { NextResponse } from 'next/server';

const DEBUG_CERT_SHA256 = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';
const SHA256_FINGERPRINT = /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/;

function getCertificateFingerprints() {
  const configured = (process.env.ANDROID_APP_CERT_SHA256 || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => SHA256_FINGERPRINT.test(value));

  return Array.from(new Set([DEBUG_CERT_SHA256, ...configured]));
}

export function GET() {
  return NextResponse.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.emirozdis.myturn',
        sha256_cert_fingerprints: getCertificateFingerprints(),
      },
    },
  ], {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
