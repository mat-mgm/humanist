use async_trait::async_trait;
use tokio::sync::broadcast;
use tonic::{transport::Server, Request, Response, Status};
use tokio_stream::wrappers::BroadcastStream;
use futures::StreamExt;
use std::pin::Pin;

use crate::ports::StateObserver;

// Include compiled proto definitions
pub mod events {
    tonic::include_proto!("events");
}

use events::event_stream_server::{EventStream, EventStreamServer};
use events::{EventResponse, ListenRequest};

#[derive(Clone)]
pub struct EventBus {
    pub sender: broadcast::Sender<EventResponse>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(100);
        Self { sender }
    }

    pub async fn start_grpc_server(self, addr: std::net::SocketAddr) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let grpc_service = GrpcEventService { bus: self };
        
        tracing::info!("Starting gRPC EventServer on {}", addr);
        Server::builder()
            .add_service(EventStreamServer::new(grpc_service))
            .serve(addr)
            .await?;
            
        Ok(())
    }
}

#[async_trait]
impl StateObserver for EventBus {
    async fn on_event(&self, topic: String, revision: u64, ulid: String) {
        let event = EventResponse { topic, revision, ulid };
        let _ = self.sender.send(event); // ignore error if no listeners
    }
}

pub struct GrpcEventService {
    bus: EventBus,
}

#[tonic::async_trait]
impl EventStream for GrpcEventService {
    type ListenEventsStream = Pin<Box<dyn futures::Stream<Item = Result<EventResponse, Status>> + Send + Sync>>;

    async fn listen_events(
        &self,
        request: Request<ListenRequest>,
    ) -> Result<Response<Self::ListenEventsStream>, Status> {
        let filter_topic = request.into_inner().filter_topic;
        
        let rx = self.bus.sender.subscribe();
        let stream = BroadcastStream::new(rx)
            .filter_map(move |res| {
                let topic = filter_topic.clone();
                async move {
                    match res {
                        Ok(event) => {
                            if topic.is_empty() || event.topic == topic {
                                Some(Ok(event))
                            } else {
                                None
                            }
                        }
                        Err(_) => None,
                    }
                }
            });

        Ok(Response::new(Box::pin(stream) as Self::ListenEventsStream))
    }
}
