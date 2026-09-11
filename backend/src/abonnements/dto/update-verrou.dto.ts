import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateVerrouDto {
  @ApiProperty({
    example: true,
    description:
      'true : les refus (quota épuisé, abonnement requis, profil incomplet) s’appliquent. ' +
      'false : ils sont seulement journalisés et la ressource est servie.',
  })
  @IsBoolean({ message: 'verrou_actif doit être un booléen' })
  verrou_actif: boolean;
}
