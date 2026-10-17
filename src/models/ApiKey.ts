import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IApiKey extends Document {
  name: string;
  /** Short, non-secret identifier used to look the key up without exposing the hash. */
  prefix: string;
  /** SHA-256 hex digest of the full key. Never leaves the server. */
  keyHash: string;
  ownerId: Types.ObjectId;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const apiKeySchema = new Schema<IApiKey>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50,
    },
    prefix: {
      type: String,
      required: true,
      unique: true,
    },
    keyHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    scopes: {
      type: [String],
      default: ['stories:read'],
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const ApiKey = mongoose.model<IApiKey>('ApiKey', apiKeySchema);
export default ApiKey;
