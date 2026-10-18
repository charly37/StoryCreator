import mongoose from 'mongoose';
import { createLogger } from './logger';

const log = createLogger('database');

const connectDB = async (): Promise<void> => {
  try {
    const MONGODB_URI = process.env.MONGODB_URI;

    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(MONGODB_URI);
    log.info('MongoDB connected successfully');
  } catch (error) {
    log.fatal({ err: error }, 'MongoDB connection error');
    process.exit(1);
  }
};

export default connectDB;
