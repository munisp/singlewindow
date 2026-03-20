/// TradeGateway™ NGSWTP — Flutter User Model
library;

class User {
  final int id;
  final String name;
  final String email;
  final String role;
  final String? traderId;
  final String? avatarUrl;

  const User({required this.id, required this.name, required this.email,
    required this.role, this.traderId, this.avatarUrl});

  factory User.fromJson(Map<String, dynamic> json) => User(
    id: json["id"] as int, name: json["name"] as String,
    email: json["email"] as String, role: json["role"] as String? ?? "user",
    traderId: json["traderId"] as String?, avatarUrl: json["avatarUrl"] as String?,
  );

  bool get isAdmin => role == "admin";
}
