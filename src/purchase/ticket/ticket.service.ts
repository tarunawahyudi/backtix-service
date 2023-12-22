import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { exceptions } from '../../common/exceptions/exceptions'
import { UserEntity } from '../../user/entities/user.entity'
import { PurchaseRepository } from '../purchase.repository'
import { PurchaseService } from '../purchase.service'

@Injectable()
export class TicketService {
  constructor(
    private purchaseRepository: PurchaseRepository,
    private purchaseService: PurchaseService,
  ) {}

  purchaseStatuses = ['PENDING', 'COMPLETED', 'CANCELLED']
  refundStatuses = ['REFUNDING', 'REFUNDED', 'DENIED']

  async myTickets(
    user: UserEntity,
    status?: string | any,
    refundStatus?: string | any,
    used?: boolean,
  ) {
    const s = this.purchaseStatuses.includes(status) ? status : 'COMPLETED'
    const rs = this.refundStatuses.includes(refundStatus)
      ? refundStatus
      : undefined

    return await this.purchaseRepository.findMany({
      where: { userId: user.id, status: s, refundStatus: rs, used },
      include: {
        ticket: {
          include: {
            event: {
              include: { images: { take: 1 } },
            },
          },
        },
      },
    })
  }

  async myTicket(user: UserEntity, uid: string) {
    const purchase = await this.purchaseRepository.findOne({
      where: { userId: user.id, uid },
      include: {
        ticket: { include: { event: { include: { images: { take: 1 } } } } },
      },
    })
    if (!purchase) throw new NotFoundException(exceptions.PURCHASE.NOT_FOUND)
    return purchase
  }

  async validateTicket(user: UserEntity, uid: string, eventId: string) {
    try {
      return await this.purchaseRepository.createTransactions(async (tx) => {
        await this.purchaseService.verifyEventOwnerByTicketPurchase(user, uid)

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { ticket: _, ...purchase } = await this.checkTicketPurchase(
          tx,
          uid,
          eventId,
        )

        return purchase
      })
    } catch (e) {
      if (e instanceof HttpException) throw e
      console.error(e)
      throw new InternalServerErrorException()
    }
  }

  async useTicket(user: UserEntity, uid: string, eventId: string) {
    try {
      return await this.purchaseRepository.createTransactions(async (tx) => {
        await this.purchaseService.verifyEventOwnerByTicketPurchase(user, uid)

        await this.checkTicketPurchase(tx, uid, eventId)

        return await tx.purchase.update({
          where: { uid },
          data: { used: true },
        })
      })
    } catch (e) {
      if (e instanceof HttpException) throw e
      console.error(e)
      throw new InternalServerErrorException()
    }
  }

  private async checkTicketPurchase(
    tx: PrismaClient,
    uid: string,
    eventId: string,
  ) {
    const purchase = await tx.purchase.findUnique({
      where: { uid },
      include: { ticket: { select: { eventId: true } } },
    })

    if (!purchase) {
      throw new NotFoundException(exceptions.PURCHASE.NOT_FOUND)
    } else if (purchase.ticket.eventId !== eventId) {
      throw new NotAcceptableException(exceptions.PURCHASE.INVALID)
    } else if (
      purchase.status !== 'COMPLETED' ||
      purchase.refundStatus === 'REFUNDED'
    ) {
      throw new NotAcceptableException(exceptions.PURCHASE.INVALID)
    } else if (purchase.used) {
      throw new NotAcceptableException(exceptions.PURCHASE.TICKET_USED)
    }

    return purchase
  }
}
