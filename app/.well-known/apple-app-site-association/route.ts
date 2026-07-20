import { NextResponse } from 'next/server';

const association = {
  applinks: {
    apps: [],
    details: [
      {
        appID: 'M4W24MNU8D.com.emirozdis.myturnapp',
        paths: ['/group/join*'],
      },
    ],
  },
};

export function GET() {
  return NextResponse.json(association, {
    headers: {
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
