import { REGION, getBatch, getConcurrentBatch, getEntries } from '../../src/utils'
import { type SendMessageBatchRequestEntry } from '@aws-sdk/client-sqs'
import { expect } from 'chai'

describe('Utils', function () {
  const originalEnv = process.env

  describe('REGION', () => {
    before(function () {
      process.env = {}
    })
    after(function () {
      process.env = originalEnv
    })
    it('Default region when environment variable not set', () => {
      expect(REGION).equal('us-east-1')
    })
  })

  describe('getBatch', () => {
    it('Should return batch of 10', () => {
      const batchGen = getBatch([...Array(15).keys()])
      expect(batchGen.next().value).to.deep.equal({ batch: [...Array(10).keys()], batchNo: 0 })
      expect(batchGen.next().value).to.deep.equal({ batch: [10, 11, 12, 13, 14], batchNo: 1 })
      expect(batchGen.next()).to.deep.equal({ value: undefined, done: true })
    })
    it('Should return batch of 2', () => {
      const batchGen = getBatch([...Array(6).keys()], 2)
      expect(batchGen.next().value).to.deep.equal({ batch: [0, 1], batchNo: 0 })
      expect(batchGen.next().value).to.deep.equal({ batch: [2, 3], batchNo: 1 })
      expect(batchGen.next().value).to.deep.equal({ batch: [4, 5], batchNo: 2 })
      expect(batchGen.next()).to.deep.equal({ value: undefined, done: true })
    })
  })

  describe('getConcurrentBatch', () => {
    it('Should return batch of 3 with concurrency 2', () => {
      const batchGen = getConcurrentBatch([...Array(14).keys()], 3, 2)
      expect(batchGen.next().value).to.deep.equal([[0, 1, 2], [3, 4, 5]])
      expect(batchGen.next().value).to.deep.equal([[6, 7, 8], [9, 10, 11]])
      expect(batchGen.next().value).to.deep.equal([[12, 13]])
      expect(batchGen.next()).to.deep.equal({ value: undefined, done: true })
    })
  })

  describe('getEntries', () => {
    const validateEntries = (entries: SendMessageBatchRequestEntry[], messages: string[]): void => {
      entries?.forEach(entry => expect(entry.MessageBody).to.deep.equal(entry.Id?.split('__')[1]))
      expect(entries?.map(entry => entry.MessageBody)).to.deep.equal(messages)
    }
    it('Should return SQS entries with 3 messages', () => {
      const batchGen = getEntries([...Array(10).keys()], {}, 3)
      validateEntries(batchGen.next().value, ['0', '1', '2'])
      validateEntries(batchGen.next().value, ['3', '4', '5'])
      validateEntries(batchGen.next().value, ['6', '7', '8'])
      validateEntries(batchGen.next().value, ['9'])
      expect(batchGen.next()).to.deep.equal({ value: undefined, done: true })
    })
  })
})
