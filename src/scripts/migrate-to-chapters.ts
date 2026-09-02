import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI!);
  console.log('Connected to MongoDB');

  // Wrap existing flat sentences[] into a single Chapter 1, then remove the old field
  const result = await mongoose.connection.collection('stories').updateMany(
    { 'sentences.0': { $exists: true }, 'chapters.0': { $exists: false } },
    [
      {
        $set: {
          chapters: [{
            seed: '',
            targetSentences: { $size: '$sentences' },
            sentences: '$sentences',
          }],
          targetChapters: 1,
        },
      },
      { $unset: ['sentences', 'targetPages'] },
    ]
  );

  console.log(`Migrated ${result.modifiedCount} stories to chapter format`);
  await mongoose.disconnect();
}

migrate().catch((err) => { console.error(err); process.exit(1); });
