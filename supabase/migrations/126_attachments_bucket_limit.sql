-- 126_attachments_bucket_limit.sql
-- Allow up to 500 MB objects in the attachments bucket (resumable uploads).
update storage.buckets set file_size_limit = 524288000 where id = 'attachments';
