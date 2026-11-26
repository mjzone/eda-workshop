import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripThinking } from '../functions/chat-proxy/index';

describe('stripThinking', () => {
  it("removes the model's reasoning and keeps the answer", () => {
    const text = '<thinking> I need the name, date of birth and last 4 digits. </thinking>\n\nPlease give me your full name.';
    assert.equal(stripThinking(text), 'Please give me your full name.');
  });

  it('removes an unclosed <thinking> block at the end', () => {
    assert.equal(stripThinking('Your passport is held. <thinking> done'), 'Your passport is held.');
  });

  it('leaves an answer without reasoning unchanged', () => {
    assert.equal(stripThinking('Your passport is held. Reference LF-7Q2K.'), 'Your passport is held. Reference LF-7Q2K.');
  });
});
