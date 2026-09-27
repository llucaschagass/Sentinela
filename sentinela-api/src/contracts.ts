import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
export const LEVELS = ['trace','debug','info','warn','error','fatal'] as const;
export class EventDto {
  @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,59}$/) environment!: string;
  @IsIn(['error','fatal']) level!: typeof LEVELS[number];
  @IsString() @MinLength(1) @MaxLength(120) type!: string;
  @IsString() @MinLength(1) @MaxLength(8000) message!: string;
  @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) occurredAt!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) origin?: string;
  @IsOptional() @IsString() @MaxLength(32000) stackTrace?: string;
  @IsOptional() @IsString() @MaxLength(1000) endpoint?: string;
  @IsOptional() @IsIn(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','CONNECT','TRACE']) httpMethod?: string;
  @IsOptional() @IsInt() @Min(100) @Max(599) httpStatus?: number;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9_.-]{1,100}$/) correlationId?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
export class FilterDto {
  @IsIn(['24h','7d','30d']) period: '24h'|'7d'|'30d' = '24h';
  @IsOptional() @IsUUID() applicationId?: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,59}$/) environment?: string;
  @IsOptional() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) asOf?: string;
}
export class PageDto extends FilterDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsIn(['count','lastOccurredAt']) sort: 'count'|'lastOccurredAt' = 'count';
  @IsIn(['asc','desc']) order: 'asc'|'desc' = 'desc';
}
export class StatusDto { @IsIn(['open','resolved']) status!: 'open'|'resolved'; }
