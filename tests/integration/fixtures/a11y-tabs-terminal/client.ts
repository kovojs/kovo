type TabName = 'billing' | 'profile';

export function selectProfile(event: Event): void {
  event.preventDefault();
  selectTab('profile');
}

export function selectBilling(event: Event): void {
  event.preventDefault();
  selectTab('billing');
}

function selectTab(active: TabName): void {
  for (const name of ['profile', 'billing'] as const) {
    const selected = name === active;
    const tab = document.getElementById(`tab-${name}`);
    const panel = document.getElementById(`panel-${name}`);
    tab?.setAttribute('aria-selected', String(selected));
    tab?.setAttribute('data-state', selected ? 'active' : 'inactive');
    if (selected) {
      panel?.removeAttribute('hidden');
      tab?.focus();
    } else {
      panel?.setAttribute('hidden', '');
    }
  }
}
