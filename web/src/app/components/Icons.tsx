import type { SVGProps } from 'react';

const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
type P = SVGProps<SVGSVGElement>;

export const IconHome = (p: P) => (<svg {...base} {...p} aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>);
export const IconBox = (p: P) => (<svg {...base} {...p} aria-hidden="true"><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>);
export const IconRoute = (p: P) => (<svg {...base} {...p} aria-hidden="true"><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6" /></svg>);
export const IconSliders = (p: P) => (<svg {...base} {...p} aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>);
export const IconPlug = (p: P) => (<svg {...base} {...p} aria-hidden="true"><path d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0z" /><path d="M12 17v5" /></svg>);
export const IconMenu = (p: P) => (<svg {...base} width={26} height={26} {...p} aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
export const IconCopy = (p: P) => (<svg {...base} width={16} height={16} {...p} aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>);
