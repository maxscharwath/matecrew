-- AlterTable: rename slackWebhookUrl to slackChannelId (values will need manual update to channel IDs)
ALTER TABLE "Office" RENAME COLUMN "slackWebhookUrl" TO "slackChannelId";
