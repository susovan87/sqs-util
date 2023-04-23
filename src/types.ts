import {
  type SendMessageRequest, type ReceiveMessageRequest, type CreateQueueRequest, type ReceiveMessageResult,
  type SendMessageBatchRequestEntry, type BatchResultErrorEntry, type Message
} from '@aws-sdk/client-sqs'

export type QueueOptions = Omit<SendMessageRequest, 'QueueUrl' | 'MessageBody' | 'MessageDeduplicationId'>

export type EnqueueOptions = Omit<SendMessageRequest, 'QueueUrl' | 'MessageBody'>

export type BulkEnqueueOptions = Omit<SendMessageBatchRequestEntry, 'Id' | 'MessageBody' | 'MessageDeduplicationId'>

export type DequeueOptions = Omit<ReceiveMessageRequest, 'QueueUrl'>

export type CreateQueueOptions = Omit<CreateQueueRequest, 'QueueName'>

export interface BulkEnqueueResult {
  /**
     * A list of MessageIds about each message that enqueued successfully.</p>
     */
  successful: string[]
  /**
     * A list of items with error details about each message that can't be enqueued.
     * The `Id` field signifies the index of the message of the input argument
     */
  failed: BatchResultErrorEntry[] | undefined
}

export interface DequeueReturnType extends ReceiveMessageResult {
  messageObjects: Json[] | undefined
  delete: () => Promise<void>
}

export type Json = null | string | number | boolean | Json[] | { [name: string]: Json }

export type MessageInStream = Pick<Message, 'Body' | 'Attributes'> & Partial<SendMessageBatchRequestEntry>
