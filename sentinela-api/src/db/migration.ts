import { MigrationInterface, QueryRunner } from 'typeorm';
export class InitialSchema1780000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE Applications (
      id uniqueidentifier NOT NULL CONSTRAINT PK_Applications PRIMARY KEY,
      name nvarchar(120) NOT NULL, slug varchar(100) NOT NULL CONSTRAINT UQ_Applications_slug UNIQUE,
      keyHash char(64) NOT NULL CONSTRAINT UQ_Applications_key UNIQUE,
      createdAt datetime2(3) NOT NULL CONSTRAINT DF_Applications_created DEFAULT SYSUTCDATETIME()
    );
    CREATE TABLE Issues (
      id uniqueidentifier NOT NULL CONSTRAINT PK_Issues PRIMARY KEY,
      applicationId uniqueidentifier NOT NULL REFERENCES Applications(id),
      environment nvarchar(60) COLLATE Latin1_General_100_BIN2 NOT NULL,
      signature char(64) NOT NULL, signatureVersion int NOT NULL,
      type nvarchar(120) NOT NULL, origin nvarchar(500) NOT NULL,
      message nvarchar(max) NOT NULL,
      firstOccurredAt datetime2(3) NOT NULL, lastOccurredAt datetime2(3) NOT NULL,
      status varchar(8) NOT NULL CONSTRAINT CK_Issues_status CHECK (status IN ('open','resolved')),
      CONSTRAINT UQ_Issues_signature UNIQUE(applicationId, environment, signature)
    );
    CREATE TABLE LogEvents (
      id uniqueidentifier NOT NULL CONSTRAINT PK_LogEvents PRIMARY KEY,
      applicationId uniqueidentifier NOT NULL REFERENCES Applications(id),
      issueId uniqueidentifier NOT NULL REFERENCES Issues(id),
      environment nvarchar(60) COLLATE Latin1_General_100_BIN2 NOT NULL,
      level varchar(10) NOT NULL CONSTRAINT CK_LogEvents_level CHECK (level IN ('error','fatal')),
      type nvarchar(120) NOT NULL, message nvarchar(max) NOT NULL,
      stackTrace nvarchar(max) NULL, occurredAt datetime2(3) NOT NULL,
      receivedAt datetime2(3) NOT NULL CONSTRAINT DF_LogEvents_received DEFAULT SYSUTCDATETIME(),
      endpoint nvarchar(1000) NULL, httpMethod varchar(10) NULL, httpStatus int NULL,
      correlationId nvarchar(100) NULL, metadata nvarchar(max) NULL,
      CONSTRAINT CK_LogEvents_metadata CHECK (metadata IS NULL OR ISJSON(metadata)=1),
      CONSTRAINT CK_LogEvents_httpStatus CHECK (httpStatus IS NULL OR httpStatus BETWEEN 100 AND 599)
    );
    CREATE INDEX IX_LogEvents_app_env_date ON LogEvents(applicationId,environment,occurredAt) INCLUDE(issueId);
    CREATE INDEX IX_LogEvents_date ON LogEvents(occurredAt) INCLUDE(applicationId,environment,issueId);
    CREATE INDEX IX_LogEvents_issue_date ON LogEvents(issueId,occurredAt DESC,id);
    CREATE INDEX IX_Issues_app_first ON Issues(applicationId,environment,firstOccurredAt);
    CREATE INDEX IX_Issues_last ON Issues(lastOccurredAt DESC);`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE LogEvents; DROP TABLE Issues; DROP TABLE Applications;');
  }
}
