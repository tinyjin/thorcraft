// What villagers trade. Gems, the collectibles scattered over the overworld, are the currency.

import { B, I, toolId } from './blocks';
import { Job } from './structures';

/** `gems` > 0: the player pays gems and receives the stack. `gems` < 0: the player hands over the stack and is paid. */
export interface Trade { id: number; count: number; gems: number }

const buy = (id: number, count: number, gems: number): Trade => ({ id, count, gems });
const sell = (id: number, count: number, gems: number): Trade => ({ id, count, gems: -gems });

export const TRADES: Record<Job, Trade[]> = {
  farmer: [buy(I.BREAD, 3, 2), buy(I.APPLE, 4, 2), buy(B.HAY, 4, 3), buy(I.PORK_COOKED, 2, 3), sell(I.WHEAT, 8, 1), sell(I.PORK_RAW, 4, 1), sell(I.BEEF_RAW, 4, 1), sell(B.WOOL_WHITE, 6, 2)],
  smith: [buy(toolId(2, 0), 1, 6), buy(toolId(2, 3), 1, 5), buy(I.IRON_INGOT, 4, 4), buy(I.IGNITER, 1, 4), buy(B.LANTERN, 4, 2), sell(I.COAL, 12, 1), sell(B.IRON_ORE, 6, 2), sell(I.DIAMOND, 1, 4)],
  librarian: [buy(B.BOOKSHELF, 2, 3), buy(B.GLASS, 8, 2), buy(B.OBSIDIAN, 10, 8), buy(I.VECTOR_EYE, 1, 10), sell(I.GOLD_INGOT, 3, 2), sell(I.LOTTIE_STAR, 1, 3), sell(I.EMBER_INGOT, 1, 5)],
};
