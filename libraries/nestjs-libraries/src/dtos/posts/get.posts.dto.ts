import {
  IsOptional,
  IsString,
  IsDateString,
  IsIn,
} from 'class-validator';

export class GetPostsDto {
  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  customer: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  display?: 'day' | 'week' | 'month';
}
