#!/usr/bin/env node

/**
 * Prints the least-privilege policy required by 30Grow object storage.
 * Usage:
 *   S3_BUCKET=30team node scripts/render-s3-iam-policy.mjs > /tmp/30team-s3-policy.json
 *   aws iam put-user-policy --user-name 30team-s3 \
 *     --policy-name 30team-object-storage \
 *     --policy-document file:///tmp/30team-s3-policy.json
 */

const bucket = String(process.env.S3_BUCKET || '').trim();
if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
  console.error('S3_BUCKET must be a valid bucket name');
  process.exit(1);
}

const bucketArn = `arn:aws:s3:::${bucket}`;
const objectArn = `${bucketArn}/companies/*`;

const policy = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'List30GrowTenantPrefixes',
      Effect: 'Allow',
      Action: ['s3:ListBucket'],
      Resource: bucketArn,
      Condition: {
        StringLike: {
          's3:prefix': [
            'companies/*',
            'companies/*/dp-docs/*',
            'companies/*/lms/*',
            'companies/*/company-posts/*',
            'image/logo/companies/*',
          ],
        },
      },
    },
    {
      Sid: 'Manage30GrowTenantObjects',
      Effect: 'Allow',
      Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      Resource: [
        `${objectArn}/dp-docs/*`,
        `${objectArn}/lms/*`,
        `${objectArn}/company-posts/*`,
        `${bucketArn}/image/logo/companies/*`,
      ],
    },
  ],
};

process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
