export interface DialogueEffect {
  popularity?: number;
  completeObjective?: string;
}
export interface DialogueChoice {
  label: string;
  next: string | null;
  effect?: DialogueEffect;
}
export interface DialogueNode {
  speaker: string;
  text: string;
  choices: DialogueChoice[];
}
export interface Dialogue {
  start: string;
  nodes: Record<string, DialogueNode>;
}

export const DIALOGUES: Record<string, Dialogue> = {
  secretary: {
    start: 'intro',
    nodes: {
      intro: {
        speaker: 'Meera Joshi, Party Secretary',
        text:
          'President, the national election is approaching. Our party has 300 members, but there are only 180 parliamentary constituencies. We must select our strongest candidates and prepare for the election.',
        choices: [
          { label: "I'm ready. What comes first?", next: 'first', effect: { completeObjective: 'meet-secretary' } },
          { label: 'How much money do we have?', next: 'funds' },
        ],
      },
      first: {
        speaker: 'Meera Joshi, Party Secretary',
        text:
          'Review the candidate list, assign election tickets, and prepare the manifesto. The candidate system opens in the next development phase — for now, explore the city and get to know the voters.',
        choices: [{ label: 'Understood.', next: null }],
      },
      funds: {
        speaker: 'Meera Joshi, Party Secretary',
        text: 'We have ₹50 crore in party funds and 35% national popularity. Campaigns will cost money, so spend carefully.',
        choices: [{ label: 'Good to know.', next: 'intro' }],
      },
    },
  },
  citizen: {
    start: 'intro',
    nodes: {
      intro: {
        speaker: 'Ravi, Local Shopkeeper',
        text: 'Leader! Prices keep rising and the road near my shop is full of potholes. What will your party do for people like me?',
        choices: [
          { label: 'We will invest in local infrastructure.', next: 'infra', effect: { popularity: 1 } },
          { label: 'We will focus on jobs and small businesses.', next: 'jobs', effect: { popularity: 1 } },
          { label: 'I need to study the issue first.', next: null },
        ],
      },
      infra: { speaker: 'Ravi, Local Shopkeeper', text: 'Roads would help a lot. I will remember that.', choices: [{ label: 'Thank you, Ravi.', next: null }] },
      jobs: { speaker: 'Ravi, Local Shopkeeper', text: 'Support for small shops is what we need. Promises are easy though — we will watch.', choices: [{ label: 'Fair enough.', next: null }] },
    },
  },
};
