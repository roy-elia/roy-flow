import { useEffect, useState } from 'react';
import { native } from './bridge';
import type { CalendarState } from '../shared/ipc';

/** calendar status and events from main (EventKit in the native helper); pushed on change */
export function useCalendar(): [CalendarState | null, (request: boolean) => Promise<CalendarState | null>] {
  const [cal, setCal] = useState<CalendarState | null>(null);
  useEffect(() => {
    if (!native) return;
    native.invoke('calendar:get', { request: false }).then(setCal);
    return native.on('calendar:changed', setCal);
  }, []);
  const refresh = async (request: boolean) => {
    if (!native) return null;
    const c = await native.invoke('calendar:get', { request });
    setCal(c);
    return c;
  };
  return [cal, refresh];
}

