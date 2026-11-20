import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { josa } from '../src/ui/josa.ts';
import { glueAddress } from '../src/ui/address.ts';
import { UNSURE_BELOW, formatBizNo, parseBizReg } from '../src/capture/bizreg.ts';

const PERSONAL = [
  '사 업 자 등 록 증',
  '(일반과세자)',
  '등록번호 : 220-81-12341',
  '상 호 : 동네마트 성수점',
  '대 표 자 : 김견본',
  '개업연월일 : 2019 년 03 월 02 일',
  '사업장 소재지 : 서울특별시 성동구 성수이로 00, 1층',
  '사업의 종류 : 업태 도매 및 소매업 종목 생활용품',
  '2019 년 03 월 04 일',
];
const CORP = [
  '사업자등록증',
  '(법인사업자)',
  '등록번호: 402-11-55667',
  '법인명(단체명): 주식회사 새봄꽃과 정원 관리 서비스',
  '대표자: 이견본',
  '사업장 소재지: 서울특별시 성동구 왕십리로 000, 새봄빌딩',
  '3층 301호(성수동2가)',
  '업 태: 서비스업',
  '종 목: 조경관리',
];

describe('사업자등록증 읽기', () => {
  it('개인 서식: 라벨 사이 띄어쓰기, 업태·종목 한 줄', () => {
    const r = parseBizReg(PERSONAL);
    assert.deepEqual(r.fields, { name: '동네마트 성수점', bizNo: '220-81-12341', ceo: '김견본', address: '서울특별시 성동구 성수이로 00, 1층', bizType: '도매 및 소매업', item: '생활용품' });
    assert.ok(r.conf.bizNo > 0.9);
    assert.equal(r.poor, false);
  });
  it('법인 서식: 법인명, 두 줄 주소(확신 낮춤)', () => {
    const r = parseBizReg(CORP);
    assert.equal(r.fields.name, '주식회사 새봄꽃과 정원 관리 서비스');
    assert.equal(r.fields.address, '서울특별시 성동구 왕십리로 000, 새봄빌딩 3층 301호(성수동2가)');
    assert.ok(r.conf.address < 0.85);
    assert.deepEqual([r.fields.bizType, r.fields.item], ['서비스업', '조경관리']);
  });
  it('검증 숫자가 틀린 번호는 확신이 낮다', () => {
    const r = parseBizReg(['등록번호 : 220-81-12345', '상호 : 동네마트']);
    assert.equal(r.fields.bizNo, '220-81-12345');
    assert.ok(r.conf.bizNo < UNSURE_BELOW);
  });
  it('글자를 거의 못 읽으면 poor', () => {
    assert.equal(parseBizReg(['사업', '록증']).poor, true);
    assert.equal(parseBizReg([]).poor, true);
  });
  it('번호 모양', () => {
    assert.equal(formatBizNo('2208112341'), '220-81-12341');
    assert.equal(formatBizNo('22081'), '220-81');
  });
});

describe('조사', () => {
  it('받침에 맞춘다', () => {
    assert.equal(josa('동네마트 성수점', '은', '는'), '동네마트 성수점은');
    assert.equal(josa('새봄꽃집', '은', '는'), '새봄꽃집은');
    assert.equal(josa('가나식자재', '은', '는'), '가나식자재는');
    assert.equal(josa('가나식자재 세금계산서', '을', '를'), '가나식자재 세금계산서를');
  });
});

describe('주소 보기 표기', () => {
  it('번지·층·괄호는 앞에 붙이고 시·구·로 사이에서만 끊는다', () => {
    const NB = '\u00A0';
    assert.equal(glueAddress('서울특별시 성동구 성수이로 00, 1층'), `서울특별시 성동구 성수이로${NB}00,${NB}1층`);
    assert.equal(glueAddress('왕십리로 000, 새봄빌딩 3층 301호(성수동2가)'), `왕십리로${NB}000,${NB}새봄빌딩${NB}3층${NB}301호(성수동2가)`);
    assert.equal(glueAddress('서울특별시 성동구 성수이로 00, 1층').replace(/\u00A0/g, ' '), '서울특별시 성동구 성수이로 00, 1층');
  });
});
