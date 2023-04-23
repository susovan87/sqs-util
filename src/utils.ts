import { type SQSClient, SendMessageBatchCommand, type SendMessageBatchRequestEntry } from '@aws-sdk/client-sqs'
import { type MessageInStream, type BulkEnqueueOptions, type BulkEnqueueResult, type Json } from './types'
import { randomUUID } from 'crypto'

const REGION: string = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1'

// A generator function that yields N items at a time from the provided array
function * getBatch (records: Json[], batchSize = 10): Generator<{ batch: Json[], batchNo: number }> {
  let batchNo = 0
  while (records.length > 0) {
    yield { batch: records.splice(0, batchSize), batchNo: batchNo++ }
  }
}

function * getConcurrentBatch (records: Json[], batchSize = 10, concurrency = 10): Generator<Json[][]> {
  for (let i = 0; i < records.length; i += batchSize * concurrency) {
    const chunked = records.slice(i, i + batchSize * concurrency)
      .reduce<Json[][]>((chunk, val, currentIndex) => {
      if (chunk[chunk.length - 1].length === batchSize) { chunk.push([]) }

      chunk[chunk.length - 1].push(val)

      return chunk
    }, [[]])

    yield chunked
  }
}

function * getEntriesIterator (records: Json[], options: BulkEnqueueOptions = {}, batchSize = 10): Generator<SendMessageBatchRequestEntry[]> {
  const idPrefix = randomUUID({ disableEntropyCache: true }) + '__'

  for (let i = 0; i < records.length; i += batchSize) {
    yield records.slice(i, i + batchSize)
      .map((item, index) =>
        Object.assign({}, options, { Id: `${idPrefix}${i + index}`, MessageBody: stringify(item) })
      )
  }
}

function getEntries (records: Array<MessageInStream | Json>, options: BulkEnqueueOptions = {}): SendMessageBatchRequestEntry[] {
  return records.map((item: MessageInStream | Json, index) => {
    const {
      Body,
      MessageBody,
      DelaySeconds,
      MessageAttributes,
      MessageSystemAttributes,
      MessageDeduplicationId,
      MessageGroupId
    }: MessageInStream = (item !== null && typeof item === 'object' && !Array.isArray(item)) ? item : {}
    const message: SendMessageBatchRequestEntry = {
      Id: `${index}`,
      MessageBody: Body ?? MessageBody ?? stringify(item)
    }
    console.log(message)
    return Object.assign({}, options, { DelaySeconds, MessageAttributes, MessageSystemAttributes, MessageDeduplicationId, MessageGroupId }, message)
  })
}

const processConcurrentBatches = async (batches: SendMessageBatchRequestEntry[][], sqsClient: SQSClient, queueUrl: string): Promise<BulkEnqueueResult> => {
  const result: BulkEnqueueResult = { successful: [], failed: [] }

  const batchResult = await Promise.allSettled(batches.map(async (entries) =>
    await sqsClient.send(new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries }))
  ))

  batchResult.forEach((item, i) => {
    if (item.status === 'fulfilled') {
      item.value.Successful?.forEach(message => (message.MessageId != null) && result.successful.push(message.MessageId))
      item.value.Failed?.forEach(message => result.failed?.push({ ...message, Id: message.Id?.split('__')[1] }))
    } else {
      batches[i].forEach(message => result.failed?.push({ Id: message.Id?.split('__')[1], Message: message.MessageBody, Code: item.reason, SenderFault: undefined }))
    }
  })

  return result
}

const stringify = (val: any): string => (val !== null && typeof val === 'object') ? JSON.stringify(val) : String(val)

const sleep = async (ms: number): Promise<number> => await new Promise((resolve) => setTimeout(resolve, ms))

export { REGION, getBatch, getConcurrentBatch, getEntriesIterator, processConcurrentBatches, sleep, getEntries, stringify }
