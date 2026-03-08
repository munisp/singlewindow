use actix_cors::Cors;
use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use graph_risk_lib::{GnnRiskPropagator, GraphQuery, TradeEdge, TradeGraph, TradeNode};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

struct AppState {
    graph: Mutex<TradeGraph>,
    propagator: GnnRiskPropagator,
}

#[derive(Deserialize)]
struct ScoreRequest {
    declaration_id: String,
    nodes: Option<Vec<serde_json::Value>>,
    edges: Option<Vec<EdgeSpec>>,
}

#[derive(Deserialize)]
struct EdgeSpec {
    from: String,
    to: String,
    rel: String,
    weight: f32,
}

#[derive(Serialize)]
struct ScoreResponse {
    declaration_id: String,
    base_score: f32,
    propagated_score: f32,
    lane: String,
    factors: Vec<serde_json::Value>,
    confidence: f32,
    engine: &'static str,
}

#[derive(Deserialize)]
struct GraphBuildRequest {
    nodes: Vec<serde_json::Value>,
    edges: Vec<EdgeSpec>,
}

#[derive(Serialize)]
struct GraphBuildResponse {
    node_count: usize,
    edge_count: usize,
}

#[derive(Deserialize)]
struct CypherQueryRequest {
    query: String,
    #[serde(rename = "queryType")]
    query_type: Option<String>,
}

#[post("/score")]
async fn score_declaration(
    data: web::Data<AppState>,
    req: web::Json<ScoreRequest>,
) -> impl Responder {
    let mut graph = data.graph.lock().unwrap();
    if let Some(nodes) = &req.nodes {
        for node_val in nodes {
            if let Ok(node) = serde_json::from_value::<TradeNode>(node_val.clone()) {
                graph.add_node(node);
            }
        }
    }
    if let Some(edges) = &req.edges {
        for e in edges {
            let edge = build_edge(&e.rel, e.weight);
            if let Err(err) = graph.add_edge(&e.from, &e.to, edge) {
                warn!("Edge add failed: {}", err);
            }
        }
    }
    match data.propagator.score_declaration(&graph, &req.declaration_id) {
        Ok(result) => {
            let factors: Vec<serde_json::Value> = result.factors.iter()
                .map(|f| serde_json::json!({
                    "type": f.factor_type,
                    "nodeId": f.node_id,
                    "contribution": f.contribution,
                    "description": f.description,
                }))
                .collect();
            HttpResponse::Ok().json(ScoreResponse {
                declaration_id: result.declaration_id,
                base_score: result.base_score,
                propagated_score: result.propagated_score,
                lane: result.lane,
                factors,
                confidence: result.confidence,
                engine: "rust-gnn-v1",
            })
        }
        Err(e) => {
            warn!("Score error: {}", e);
            HttpResponse::UnprocessableEntity().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

#[post("/graph/build")]
async fn build_graph(
    data: web::Data<AppState>,
    req: web::Json<GraphBuildRequest>,
) -> impl Responder {
    let mut graph = data.graph.lock().unwrap();
    *graph = TradeGraph::new();
    for node_val in &req.nodes {
        if let Ok(node) = serde_json::from_value::<TradeNode>(node_val.clone()) {
            graph.add_node(node);
        }
    }
    for e in &req.edges {
        let edge = build_edge(&e.rel, e.weight);
        let _ = graph.add_edge(&e.from, &e.to, edge);
    }
    let node_count = graph.graph.node_count();
    let edge_count = graph.graph.edge_count();
    info!("Graph rebuilt: {} nodes, {} edges", node_count, edge_count);
    HttpResponse::Ok().json(GraphBuildResponse { node_count, edge_count })
}

#[post("/graph/query")]
async fn graph_query(req: web::Json<CypherQueryRequest>) -> impl Responder {
    let cypher = match req.query_type.as_deref() {
        Some("trader_declarations") => GraphQuery::trader_declarations(&req.query, 30),
        Some("sanctions_network") => GraphQuery::sanctions_network(&req.query),
        Some("high_risk_corridors") => {
            let min_risk: f32 = req.query.parse().unwrap_or(0.5);
            GraphQuery::high_risk_corridors(min_risk)
        }
        Some("oga_sla_breaches") => GraphQuery::oga_sla_breaches(),
        Some("similar_hs_patterns") => GraphQuery::similar_hs_patterns(&req.query),
        _ => req.query.clone(),
    };
    HttpResponse::Ok().json(serde_json::json!({ "cypher": cypher }))
}

#[get("/health")]
async fn health(data: web::Data<AppState>) -> impl Responder {
    let graph = data.graph.lock().unwrap();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "engine": "rust-gnn-v1",
        "graph_nodes": graph.graph.node_count(),
        "graph_edges": graph.graph.edge_count(),
    }))
}

fn build_edge(rel: &str, weight: f32) -> TradeEdge {
    match rel {
        "SUBMITTED" => TradeEdge::Submitted { timestamp: 0, weight },
        "CLASSIFIED_UNDER" => TradeEdge::ClassifiedUnder { weight },
        "ARRIVED_AT" => TradeEdge::ArrivedAt { weight },
        "REQUIRES_PERMIT_FROM" => TradeEdge::RequiresPermitFrom { weight },
        "MATCHES_SANCTION" => TradeEdge::MatchesSanction { similarity: weight, weight },
        "FOLLOWS_CORRIDOR" => TradeEdge::FollowsCorridor { weight },
        _ => TradeEdge::RelatedTo { relationship_type: rel.to_string(), weight },
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("graph_risk=info".parse().unwrap()),
        )
        .json()
        .init();
    let port: u16 = std::env::var("GRAPH_RISK_PORT")
        .unwrap_or_else(|_| "8090".to_string())
        .parse()
        .unwrap_or(8090);
    info!("Starting graph-risk engine on port {}", port);
    let state = web::Data::new(AppState {
        graph: Mutex::new(TradeGraph::new()),
        propagator: GnnRiskPropagator::default(),
    });
    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header();
        App::new()
            .wrap(cors)
            .app_data(state.clone())
            .service(score_declaration)
            .service(build_graph)
            .service(graph_query)
            .service(health)
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
