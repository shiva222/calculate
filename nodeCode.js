async syncSalesmanPayment(req, res) {
    try {
        const { recordLimit } = req.params;
        const unsyncedData = await merchantBalanceOrderModel.findAll({
            raw: true,
            where: { dataSynced: false },
            order: [['createdAt', 'ASC']],
            limit: +recordLimit,
        });
        if (unsyncedData.length === 0) {
            return res.status(200).json({ message: 'No unsynced data found' });
        }

        for (const info of unsyncedData) {
            const { salesmanId } = info;
            const transaction = await db.transaction({ autocommit: false });
            try {
                const salesman = await salesmanModel.findOne({
                    raw: true,
                    where: { employeeId: salesmanId },
                    lock: transaction.LOCK.UPDATE,
                    skipLocked: true,
                    transaction,
                });

                if (!salesman) {
                    await transaction.rollback();
                    return res.status(404).json({ message: `Salesman with ID ${salesmanId} not found` });
                }

                const merchantBalancePaymentList = await merchantBalancePaymentModel.findAll({
                    raw: true,
                    where: { balanceOrderId: info.id },
                    lock: transaction.LOCK.UPDATE,
                    skipLocked: true,
                    transaction,
                });

                const paymentUpdates = [];
                const proxyUpdates = [];
                let startCashOnHand = parseFloat(salesman.cashOnHand);
                let startCredit = parseFloat(salesman.credit);
                let endBalance = parseFloat(salesman.balance);

                for (const payment of merchantBalancePaymentList) {
                    const { pendingAmount, cashAmount } = payment;
                    const endCredit = startCredit + parseFloat(pendingAmount);

                    const paymentUpdate = {
                        ...payment,
                        startOnHand: startCashOnHand,
                        endOnHand: startCashOnHand,
                        startCredit,
                        endCredit,
                    };
                    paymentUpdates.push(paymentUpdate);

                    endBalance -= parseFloat(pendingAmount);
                    startCredit += parseFloat(pendingAmount);

                    const merchantBalancePaymentProxy = await merchantbalancepaymentProxyModel.findOne({
                        raw: true,
                        where: { uuid_: payment.proxyPaymentId },
                        lock: transaction.LOCK.UPDATE,
                        skipLocked: true,
                        transaction,
                    });

                    if (merchantBalancePaymentProxy) {
                        const merchantBalancePaymentProxyList = await merchantbalancepaymentProxyModel.findAll({
                            raw: true,
                            where: {
                                madaPaymentUuid: merchantBalancePaymentProxy.madaPaymentUuid,
                            },
                            transaction,
                        });

                        merchantBalancePaymentProxyList.forEach(proxy => {
                            proxy.startOnHand = startCashOnHand;
                            proxy.endOnHand = startCashOnHand + parseFloat(cashAmount);
                            proxyUpdates.push(proxy);

                            const merchantPayment = merchantBalancePaymentList.find(mp => mp.proxyPaymentId === proxy.uuid_);
                            if (merchantPayment) {
                                merchantPayment.startOnHand = startCashOnHand;
                                merchantPayment.endOnHand = proxy.endOnHand;
                                merchantPayment.startCredit = startCredit;
                                merchantPayment.endCredit = startCredit - parseFloat(merchantPayment.cashAmount);

                                paymentUpdates.push(merchantPayment);
                            }

                            startCashOnHand = proxy.endOnHand;
                            startCredit -= parseFloat(cashAmount);
                        });
                    }
                }

                const uniquePaymentUpdates = Object.values(
                    paymentUpdates.reduce((acc, curr) => {
                        acc[curr.id] = curr;
                        return acc;
                    }, {})
                );

                const uniqueProxyUpdates = Object.values(
                    proxyUpdates.reduce((acc, curr) => {
                        acc[curr.uuid_] = curr;
                        return acc;
                    }, {})
                );

                await merchantBalancePaymentModel.bulkCreate(uniquePaymentUpdates, {
                    updateOnDuplicate: ['startOnHand', 'endOnHand', 'startCredit', 'endCredit'],
                    transaction,
                });

                await merchantbalancepaymentProxyModel.bulkCreate(uniqueProxyUpdates, {
                    updateOnDuplicate: ['startOnHand', 'endOnHand'],
                    transaction,
                });

                await salesmanModel.update(
                    { balance: endBalance, cashOnHand: startCashOnHand },
                    { where: { employeeId: salesmanId }, transaction }
                );

                await merchantBalanceOrderModel.update(
                    {
                        dataSynced: true,
                        syncedAt: new Date(),
                        salesmanStartBalance: parseFloat(salesman.balance),
                        salesmanEndBalance: endBalance,
                    },
                    { where: { id: info.id }, transaction }
                );

                await transaction.commit();
            } catch (error) {
                await transaction.rollback();
                throw error;
            }
        }

        return res.status(200).json({ message: 'Data synced successfully' });
    } catch (error) {
        return res.status(500).json(rspCode.DEFAULT);
    }
}