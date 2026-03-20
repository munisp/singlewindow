/// TradeGateway™ NGSWTP — Flutter Declaration Models
library;

class Declaration {
  final int id;
  final String ucr;
  final String status;
  final String declarantName;
  final String importerName;
  final String exporterName;
  final String hsCode;
  final String goodsDescription;
  final double customsValue;
  final String currency;
  final String portOfEntry;
  final String countryOfOrigin;
  final String? riskLane;
  final double? riskScore;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Declaration({
    required this.id,
    required this.ucr,
    required this.status,
    required this.declarantName,
    required this.importerName,
    required this.exporterName,
    required this.hsCode,
    required this.goodsDescription,
    required this.customsValue,
    required this.currency,
    required this.portOfEntry,
    required this.countryOfOrigin,
    this.riskLane,
    this.riskScore,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Declaration.fromJson(Map<String, dynamic> json) => Declaration(
    id: json["id"] as int,
    ucr: json["ucr"] as String,
    status: json["status"] as String,
    declarantName: json["declarantName"] as String? ?? "",
    importerName: json["importerName"] as String? ?? "",
    exporterName: json["exporterName"] as String? ?? "",
    hsCode: json["hsCode"] as String? ?? "",
    goodsDescription: json["goodsDescription"] as String? ?? "",
    customsValue: (json["customsValue"] as num?)?.toDouble() ?? 0.0,
    currency: json["currency"] as String? ?? "NGN",
    portOfEntry: json["portOfEntry"] as String? ?? "",
    countryOfOrigin: json["countryOfOrigin"] as String? ?? "",
    riskLane: json["riskLane"] as String?,
    riskScore: (json["riskScore"] as num?)?.toDouble(),
    createdAt: DateTime.parse(json["createdAt"] as String),
    updatedAt: DateTime.parse(json["updatedAt"] as String),
  );

  Map<String, dynamic> toJson() => {
    "id": id, "ucr": ucr, "status": status, "declarantName": declarantName,
    "importerName": importerName, "exporterName": exporterName, "hsCode": hsCode,
    "goodsDescription": goodsDescription, "customsValue": customsValue,
    "currency": currency, "portOfEntry": portOfEntry, "countryOfOrigin": countryOfOrigin,
    "riskLane": riskLane, "riskScore": riskScore,
    "createdAt": createdAt.toIso8601String(), "updatedAt": updatedAt.toIso8601String(),
  };

  String get statusColor {
    switch (status) {
      case "cleared": return "#10B981";
      case "pending": return "#F59E0B";
      case "rejected": return "#EF4444";
      case "under_review": return "#3B82F6";
      default: return "#6B7280";
    }
  }

  String get riskLaneColor {
    switch (riskLane) {
      case "GREEN": return "#10B981";
      case "YELLOW": return "#F59E0B";
      case "RED": return "#EF4444";
      default: return "#6B7280";
    }
  }
}

class DeclarationListResult {
  final List<Declaration> declarations;
  final int total;
  final int page;
  final int totalPages;

  const DeclarationListResult({
    required this.declarations,
    required this.total,
    required this.page,
    required this.totalPages,
  });

  factory DeclarationListResult.fromJson(Map<String, dynamic> json) => DeclarationListResult(
    declarations: (json["declarations"] as List<dynamic>? ?? [])
        .map((e) => Declaration.fromJson(e as Map<String, dynamic>))
        .toList(),
    total: json["total"] as int? ?? 0,
    page: json["page"] as int? ?? 1,
    totalPages: json["totalPages"] as int? ?? 1,
  );
}
