import { describe, expect, it } from 'vitest';
import { addSegment, isEcho, overlap } from '../src/shared/echo';
import type { TranscriptSegment } from '../src/shared/types';

const them = (t: number, text: string, d = 5): TranscriptSegment => ({ t, d, text, who: 'them' });
const you = (t: number, text: string, d = 5): TranscriptSegment => ({ t, d, text });

describe('meeting echo removal', () => {
  it('measures how much of the mic line the system line has', () => {
    expect(overlap('We moved the API gateway last week', 'We moved the API gateway and billing last week.')).toBe(1);
    expect(overlap('Sounds good to me', 'We moved the API gateway')).toBe(0);
    expect(overlap('Réévalue en janvier', 'on réévalue en janvier')).toBe(1);
  });
  it('drops a mic line that repeats what the call said at the same time', () => {
    const list = [them(10, 'The remaining three services should be done by October 14.')];
    expect(isEcho(you(10.4, 'remaining three services should be done by October'), list)).toBe(true);
    expect(addSegment(list, you(10.4, 'remaining three services should be done by October'))).toHaveLength(1);
  });
  it('keeps the same words said much later, and the user talking over the call', () => {
    const list = [them(10, 'Can you send me the load test plan by Friday?')];
    expect(isEcho(you(60, 'Can you send me the load test plan by Friday?'), list)).toBe(false);
    expect(isEcho(you(11, 'Yes, I will send it by Friday.'), list)).toBe(false);
  });
  it('removes an earlier mic echo when the call line arrives second', () => {
    const list = [you(20, 'we ship the new onboarding in version 1.4')];
    const out = addSegment(list, them(19.5, "Let's try that. We ship the new onboarding in version 1.4."));
    expect(out).toEqual([them(19.5, "Let's try that. We ship the new onboarding in version 1.4.")]);
  });
  it('keeps lines in time order', () => {
    let l: TranscriptSegment[] = [];
    l = addSegment(l, you(30, 'third'));
    l = addSegment(l, them(5, 'first line here'));
    l = addSegment(l, you(12, 'second'));
    expect(l.map((x) => x.text)).toEqual(['first line here', 'second', 'third']);
  });
});
