import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickKind, unlockLabel } from '../src/biometryLabel.ts';

describe('잠금 해제 단추 문구', () => {
  it('기기 종류에 맞춘다', () => {
    assert.equal(unlockLabel(pickKind(['face'], 'ios')), 'Face ID로 열기');
    assert.equal(unlockLabel(pickKind(['fingerprint'], 'ios')), 'Touch ID로 열기');
    assert.equal(unlockLabel(pickKind(['fingerprint', 'face'], 'android')), '얼굴로 열기');
    assert.equal(unlockLabel(pickKind(['fingerprint'], 'android')), '지문으로 열기');
    assert.equal(unlockLabel(pickKind([], 'ios')), '열기');
  });
});
