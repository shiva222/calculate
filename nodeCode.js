/*
useCase: We have multiple merchants and multiple salesman,
Each salesman has many merchants.
When merchant make a transaction salesman balance need to be reduced. It created a race condition when all merchant try to reduce balance from 
single merchant. As locks are in place first req to reach server will be successful. 

To resolve the issue I have made the process into 2 parts. 
1. add balance to the merchant directly.
2. reduce balance from salesman all togeather when api is hit.

syncSalesmanSummary in this function merchantCount we get from req.params
            attributes: [
              [Sequelize.col('merchant_id'), 'merchantId'],
              [Sequelize.col('salesman_id'), 'salesmanId'],
              [Sequelize.literal('array_agg(id)'), 'idList'],
              [Sequelize.literal('SUM("amount")'), 'totalAmount'],
              [Sequelize.literal('COUNT(*)'), 'totalRecords']
            ],
            where: {
              data_synced: false
            },
            group: ['merchant_id', 'salesman_id'],
            limit: merchantCount,
            raw: true
     this is a Sequelize query on db to group merchant_id and salesman_id and sum total amount to be reduced in totalAmount, idList that holds list 
     of primary ids that are used for later modification, totalRecords for number of times merchant made transactions

                 const transaction = await db.transaction({ autocommit: false });
transactions are used to commit everything or nothing case.
find the salesman and lock him till his balance is changed
update the salesman balance
store the changes made in merchantBalanceOrderSummaryModel table it will have id as primary key
update the id(summeryId) primary key in merchantBalanceOrderModel table that has id present in idList


syncSalesmanPayment is updating salesman balance by transaction by transaction.
the potential drawback with this is it takes lot of time but it can track start and end balance for transaction by transaction and update in bulk process
*/

router.get('/reduceBalanceByMerchant/:merchantCount', MADA.syncSalesmanSummary);
router.get('/reduceBalancebyTransaction/:recordLimit', MADA.syncSalesmanPayment);

async syncSalesmanSummary(req, res) {
    try {
        const { merchantCount } = req.params;
        const result = await merchantBalanceOrderModel.findAll({
            attributes: [
                [Sequelize.col('merchant_id'), 'merchantId'],
                [Sequelize.col('salesman_id'), 'salesmanId'],
                [Sequelize.literal('array_agg(id)'), 'idList'],
                [Sequelize.literal('SUM("amount")'), 'totalAmount'],
                [Sequelize.literal('COUNT(*)'), 'totalRecords']
            ],
            where: {
                data_synced: false
            },
            group: ['merchant_id', 'salesman_id'],
            limit: +merchantCount,
            raw: true
        });
        for (const info of result) {
            const transaction = await db.transaction({ autocommit: false });
            try {
                const salesman = await salesmanModel.findOne({
                    raw: true,
                    where: { employeeId: info.salesmanId },
                    lock: transaction.LOCK.UPDATE,
                    skipLocked: true,
                    transaction,
                });

                if (!salesman) {
                    await transaction.rollback();
                    return res.status(404).json({ message: `Salesman with ID ${info.salesmanId} not found` });
                }
                let endBalance = parseFloat(salesman.balance);
                endBalance -= parseFloat(info.totalAmount)
                const { merchantId, salesmanId, totalAmount, totalRecords, idList } = info;

                await salesmanModel.update(
                    { balance: endBalance },
                    { where: { employeeId: salesmanId }, transaction }
                );


                const summary = await merchantBalanceOrderSummaryModel.create({ merchantId, salesmanId, totalAmount, totalRecords }, { transaction });
                const summaryId = summary.id;
                await merchantBalanceOrderModel.update(
                    { dataSynced: true, batchId: summaryId, syncedAt: new Date() },
                    {
                        where: {
                            id: {
                                [Sequelize.Op.in]: idList
                            }
                        },
                        transaction
                    }
                );
                await transaction.commit();
            } catch (error) {
                console.log(error);

            }
        }
        console.log(result);
        return res.status(200).json(result);

    } catch (error) {
        console.log(error);
        return res.status(500).json(rspCode.DEFAULT);
    }
},


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