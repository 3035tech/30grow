/**
 * Shared stroke icons for dashboard chrome (sidebar, toggles, KPIs).
 * viewBox 24×24, rendered 18×18 — matches former NavIcon.
 */
export function Icon({ name, className }) {
  const sizedByClass = className && /\b(?:h-|w-|size-)/.test(className);
  const props = {
    ...(sizedByClass ? {} : { width: 18, height: 18 }),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className: className || 'shrink-0',
  };
  switch (name) {
    case 'overview':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'team':
      return (
        <svg {...props}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="3" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a3 3 0 0 1 0 5.75" />
        </svg>
      );
    case 'compatibility':
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="3" />
          <circle cx="16" cy="16" r="3" />
          <path d="M10.5 10.5 13.5 13.5" />
        </svg>
      );
    case 'compare':
      return (
        <svg {...props}>
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
    case 'group':
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3" />
          <circle cx="6.5" cy="16" r="2.5" />
          <circle cx="17.5" cy="16" r="2.5" />
        </svg>
      );
    case 'leadership':
      return (
        <svg {...props}>
          <path d="M12 3 14.5 9.5 21 10.5 16 15.2 17.5 21.5 12 18.2 6.5 21.5 8 15.2 3 10.5 9.5 9.5Z" />
        </svg>
      );
    case 'vacancies':
      return (
        <svg {...props}>
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'motivators':
      return (
        <svg {...props}>
          <path d="M12 3c2.5 3.5 6 5.5 6 10a6 6 0 0 1-12 0c0-4.5 3.5-6.5 6-10Z" />
        </svg>
      );
    case 'climate':
      return (
        <svg {...props}>
          <path d="M12 3v2" />
          <path d="M12 19v2" />
          <path d="M5 12H3" />
          <path d="M21 12h-2" />
          <circle cx="12" cy="12" r="4" />
          <path d="M8.5 8.5 7 7" />
          <path d="M17 17l-1.5-1.5" />
          <path d="M15.5 8.5 17 7" />
          <path d="M7 17l1.5-1.5" />
        </svg>
      );
    case 'companies':
    case 'building':
      return (
        <svg {...props}>
          <path d="M4 21V6a2 2 0 0 1 2-2h7v17" />
          <path d="M13 10h5a2 2 0 0 1 2 2v9" />
          <path d="M8 8h1" />
          <path d="M8 12h1" />
          <path d="M8 16h1" />
          <path d="M16 14h1" />
          <path d="M16 18h1" />
        </svg>
      );
    case 'users':
    case 'user':
      return (
        <svg {...props}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="3" />
        </svg>
      );
    case 'help':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5" />
          <path d="M12 17h.01" />
        </svg>
      );
    case 'sparkles':
    case 'ai':
      return (
        <svg {...props}>
          <path d="M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3z" />
          <path d="M18.5 13.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z" />
          <path d="M5.5 14.5l.55 1.65 1.65.55-1.65.55-.55 1.65-.55-1.65-1.65-.55 1.65-.55.55-1.65z" />
        </svg>
      );
    case 'logout':
      return (
        <svg {...props}>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      );
    case 'collapse':
      return (
        <svg {...props}>
          <path d="M15 18 9 12l6-6" />
        </svg>
      );
    case 'expand':
    case 'chevronRight':
      return (
        <svg {...props}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      );
    case 'chevronDown':
      return (
        <svg {...props}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'close':
    case 'x':
      return (
        <svg {...props}>
          <path d="M18 6 6 18" />
          <path d="M6 6l12 12" />
        </svg>
      );
    case 'search':
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      );
    case 'clear':
      return (
        <svg {...props}>
          <path d="M18 6 6 18" />
          <path d="M6 6l12 12" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...props}>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      );
    case 'moreHorizontal':
      return (
        <svg {...props}>
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'list':
      return (
        <svg {...props}>
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      );
    case 'kanban':
      return (
        <svg {...props}>
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="12" rx="1" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...props}>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 16V10" />
          <path d="M13 16V7" />
          <path d="M18 16v-4" />
        </svg>
      );
    case 'copy':
      return (
        <svg {...props}>
          <rect x="9" y="9" width="11" height="11" rx="1.5" />
          <path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" />
        </svg>
      );
    case 'externalLink':
      return (
        <svg {...props}>
          <path d="M14 4h6v6" />
          <path d="M10 14 20 4" />
          <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
        </svg>
      );
    case 'download':
      return (
        <svg {...props}>
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      );
    case 'plus':
    case 'add':
      return (
        <svg {...props}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...props}>
          <path d="M3 6h18" />
          <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
          <path d="M6.5 6l.8 13.2A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 6" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...props}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );
    case 'eye':
    case 'view':
      return (
        <svg {...props}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'print':
      return (
        <svg {...props}>
          <path d="M6 9V3h12v6" />
          <path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="13" width="12" height="8" rx="1" />
        </svg>
      );
    case 'check':
    case 'feedbackOk':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.5 2.2 2.2 4.8-5.2" />
        </svg>
      );
    case 'alert':
    case 'feedbackWarning':
      return (
        <svg {...props}>
          <path d="M12 3.5 21 19.5H3Z" />
          <path d="M12 10v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...props}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.7 1.7 0 0 0 3.4 0" />
        </svg>
      );
    case 'infoCircle':
    case 'feedbackInfo':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5" />
          <path d="M12 8h.01" />
        </svg>
      );
    case 'feedbackError':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6" />
          <path d="m15 9-6 6" />
        </svg>
      );
    case 'briefcase':
    case 'jobRoles':
      return (
        <svg {...props}>
          <rect x="3" y="8" width="18" height="12" rx="2" />
          <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M3 13h18" />
        </svg>
      );
    case 'clipboard':
    case 'performanceReviews':
      return (
        <svg {...props}>
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M9 4.5V3.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3.5v1" />
          <path d="M9 10h6" />
          <path d="M9 14h6" />
        </svg>
      );
    case 'dp':
      return (
        <svg {...props}>
          <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H14l4 4v10.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18.5Z" />
          <path d="M14 4v4h4" />
          <path d="M8 12h7" />
          <path d="M8 15h5" />
        </svg>
      );
    case 'gift':
    case 'benefits':
      return (
        <svg {...props}>
          <rect x="4" y="10" width="16" height="10" rx="1.5" />
          <path d="M12 10v10" />
          <path d="M4 14h16" />
          <path d="M12 10c-2.2 0-4-1.3-4-3s1.2-2.2 2.5-1.5C11.2 6 12 7.2 12 10Z" />
          <path d="M12 10c2.2 0 4-1.3 4-3s-1.2-2.2-2.5-1.5C12.8 6 12 7.2 12 10Z" />
        </svg>
      );
    case 'book':
    case 'academy':
      return (
        <svg {...props}>
          <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21.5Z" />
          <path d="M5 5.5V21.5" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...props}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      );
    case 'calendarClock':
      return (
        <svg {...props}>
          <path d="M20.5 11V7a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v11.5a2 2 0 0 0 2 2H11" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
          <circle cx="17" cy="17" r="4" />
          <path d="M17 15.5V17l1 1" />
        </svg>
      );
    case 'clock':
    case 'timeClock':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'mapPin':
      return (
        <svg {...props}>
          <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...props}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case 'exit':
    case 'door':
      return (
        <svg {...props}>
          <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
          <path d="M15 16l4-4-4-4" />
          <path d="M19 12H10" />
        </svg>
      );
    case 'succession':
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="2.5" />
          <circle cx="16" cy="8" r="2.5" />
          <circle cx="12" cy="17" r="2.5" />
          <path d="M9.5 10.2 11 14.5" />
          <path d="M14.5 10.2 13 14.5" />
        </svg>
      );
    case 'refresh':
    case 'refresh-cw':
      return (
        <svg {...props}>
          <path d="M21 12a9 9 0 1 1-2.6-6.3" />
          <path d="M21 3v6h-6" />
        </svg>
      );
    case 'salary':
      return (
        <svg {...props}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M7 12h0.01M17 12h0.01" />
        </svg>
      );
    case 'okr':
    case 'target':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      );
    default:
      return null;
  }
}
