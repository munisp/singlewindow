/// TradeGateway™ NGSWTP — Flutter Payment Models
library;

class Payment {
  final int id;
  final String reference;
  final String status;
  final double amount;
  final String currency;
  final String paymentMethod;
  final String? declarationUcr;
  final DateTime createdAt;

  const Payment({required this.id, required this.reference, required this.status,
    required this.amount, required this.currency, required this.paymentMethod,
    this.declarationUcr, required this.createdAt});

  factory Payment.fromJson(Map<String, dynamic> json) => Payment(
    id: json["id"] as int, reference: json["reference"] as String,
    status: json["status"] as String, amount: (json["amount"] as num).toDouble(),
    currency: json["currency"] as String? ?? "NGN",
    paymentMethod: json["paymentMethod"] as String? ?? "mojaloop",
    declarationUcr: json["declarationUcr"] as String?,
    createdAt: DateTime.parse(json["createdAt"] as String),
  );
}
