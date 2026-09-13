import { defineHook } from 'eve/hooks';
import { resetTurnBudget } from '../lib/turn-budget';

export default defineHook({
  events: {
    'turn.started'() {
      resetTurnBudget();
    },
  },
});
