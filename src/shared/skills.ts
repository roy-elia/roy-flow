/* Notetaker skills (Wispr's slash commands in Ask): ready-made requests about a meeting note. Type "/" in Ask. */
export interface Skill {
  id: string;
  label: string;
  desc: string;
  prompt: string;
}

export const SKILLS: Skill[] = [
  { id: 'follow-up', label: 'Follow-up email', desc: 'Email to the attendees with decisions and next steps', prompt: 'Write a short follow-up email to the meeting attendees: a one-line thank-you, the key decisions, and the next steps with owners and dates. Plain text, ready to paste, with a subject line.' },
  { id: 'action-items', label: 'Action items', desc: 'Every task, with its owner and due date', prompt: 'List every action item from this meeting as a checklist: the task, the owner and the due date when one was mentioned. Nothing else.' },
  { id: 'project-update', label: 'Project update', desc: 'Status update for the project channel', prompt: 'Write a concise project status update from this meeting for a team channel: progress, risks or blockers, and what happens next. Use short bullet points.' },
  { id: 'leadership-update', label: 'Leadership update', desc: 'Three-line summary for leadership', prompt: 'Write a three-line update for leadership: the outcome, the main risk, and any decision or help needed from them.' },
  { id: 'crm-update', label: 'CRM update', desc: 'Notes for a CRM record', prompt: 'Write CRM notes for this meeting: account or contact, what was discussed, needs and objections, agreed next step and date. Short labelled lines.' },
];

/** skills whose name matches what follows the "/" */
export const matchSkills = (q: string): Skill[] => {
  if (!q.startsWith('/')) return [];
  const t = q.slice(1).trim().toLowerCase();
  return SKILLS.filter((s) => !t || s.label.toLowerCase().includes(t) || s.id.includes(t));
};
