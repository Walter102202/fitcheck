import { runDryerSilent, runDryerSpain, runSonyAsk, type Scenario } from '@fitcheck/contracts';

// Fixture copies of lane C's four demo purchases (01-foundation, "Scenarios"), in Home order.
// The copy in `shows` is the approved mockup's.

const PANASONIC_IMAGE =
  'https://cdn.trychannel3.com/b448c604-68b9-46f6-b987-504df34e375f?aid=01M73RZT135STZBGRM5VFRTZKD&mid=RnUy';

function firstImage(run: { attempts: { pick: { image: string | null } }[] }): string {
  return run.attempts[0]?.pick.image ?? '';
}

export const FIXTURE_SCENARIOS: Scenario[] = [
  {
    id: 'dryer-spain',
    category: 'hair_dryer',
    request: 'A hair dryer for my trip to Spain next week. Under $40.',
    title: 'A hair dryer for a trip to Spain',
    image: firstImage(runDryerSpain),
    shows: 'The agent picks one for $29.29 at walmart.com. Its listing says 110V–120V only.',
    endsIn: 'Not captured, then the second pick is captured.',
    showcase: 'broken',
  },
  {
    id: 'dryer-silent',
    category: 'hair_dryer',
    request: 'The cheapest hair dryer you can find for my trip to Spain.',
    title: 'The cheapest hair dryer for Spain',
    image: firstImage(runDryerSilent),
    shows:
      'The agent picks a Conair 1875 Watt, $14.99 at boscovs.com. Its listing says nothing about voltage.',
    endsIn: 'On hold, with one question for the buyer.',
    showcase: 'unbacked',
  },
  {
    id: 'tv-sony',
    category: 'tv',
    request: 'A 65-inch OLED TV for the living room. Up to $1,500.',
    title: 'A 65-inch OLED TV',
    image: firstImage(runSonyAsk),
    shows:
      'The agent picks a Sony BRAVIA 8, $1,398.00 at pcrichard.com. Its listing gives two screen sizes.',
    endsIn: 'On hold, with one question for the buyer.',
    showcase: 'contradictory',
  },
  {
    id: 'tv-wall',
    category: 'tv',
    request: 'Replace the TV on our living room wall with a 65-inch, up to $1,600.',
    title: 'A 65-inch TV for the wall',
    image: PANASONIC_IMAGE,
    shows:
      'The agent picks a Panasonic W80C, $499.99 at beachcamera.com. Nobody asked which wall mount you have.',
    endsIn: 'On hold; after a no, the agent picks again.',
    showcase: 'never_asked',
  },
];

export { PANASONIC_IMAGE };
