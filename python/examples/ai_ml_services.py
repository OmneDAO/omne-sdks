"""
AI/ML Computational Services Example

This example demonstrates:
- Submitting AI/ML training jobs to OON
- Monitoring job progress
- Different job types and configurations
- Cost management and optimization
"""

import asyncio
from decimal import Decimal
from omne_sdk import OmneClient, Wallet
from omne_sdk.types import ComputationalJobRequest, JobType, JobStatus


async def ai_ml_services_example():
    """Demonstrate AI/ML computational services via OON"""
    
    print("🤖 Omne Python SDK - AI/ML Computational Services")
    print("=" * 55)
    
    client = OmneClient("http://localhost:8545")
    
    try:
        # Create wallet for submitting jobs
        wallet = Wallet.generate()
        print(f"\n👤 Job Submitter: {wallet.address}")
        
        # Check network capabilities
        network_info = await client.get_network_info()
        if not network_info.features.get('oonEnabled', False):
            print("❌ OON (Omne Orchestration Network) not enabled on this network")
            return
        
        print("✅ OON computational services available")
        
        # Example 1: AI Model Training
        print("\n🎯 Example 1: AI Model Training")
        training_job = ComputationalJobRequest(
            job_type=JobType.AI_TRAINING,
            data_source="s3://ml-datasets/image-classification-10k.tar.gz",
            parameters={
                "model_type": "resnet50",
                "epochs": 50,
                "batch_size": 32,
                "learning_rate": 0.001,
                "optimizer": "adam",
                "data_augmentation": True,
                "validation_split": 0.2
            },
            max_cost_omc=Decimal("25.0"),  # Maximum 25 OMC
            timeout_minutes=180,  # 3 hours max
            priority=8,  # High priority
            requirements={
                "gpu_memory_gb": 8,
                "gpu_type": ["RTX3080", "RTX4080", "A100"],
                "min_cpu_cores": 8,
                "min_ram_gb": 32
            }
        )
        
        print("  📊 Job Configuration:")
        print(f"    Model: {training_job.parameters['model_type']}")
        print(f"    Epochs: {training_job.parameters['epochs']}")
        print(f"    Max Cost: {training_job.max_cost_omc} OMC")
        print(f"    Timeout: {training_job.timeout_minutes} minutes")
        print(f"    GPU Requirements: {', '.join(training_job.requirements['gpu_type'])}")
        
        # Submit training job
        print("\n  🚀 Submitting AI training job...")
        training_job_result = await client.submit_computational_job(
            training_job,
            from_address=wallet.address
        )
        
        print(f"  ✅ Job submitted: {training_job_result.job_id}")
        print(f"  📅 Created: {training_job_result.created_at}")
        print(f"  📊 Status: {training_job_result.status.value}")
        
        # Example 2: AI Inference
        print("\n🔮 Example 2: AI Inference")
        inference_job = ComputationalJobRequest(
            job_type=JobType.AI_INFERENCE,
            data_source="https://api.example.com/inference-batch-123",
            parameters={
                "model_id": "stable-diffusion-xl",
                "batch_size": 100,
                "output_format": "png",
                "resolution": "1024x1024",
                "inference_steps": 20,
                "guidance_scale": 7.5
            },
            max_cost_omc=Decimal("5.0"),  # Maximum 5 OMC
            timeout_minutes=30,
            priority=5,  # Medium priority
            requirements={
                "gpu_memory_gb": 12,
                "gpu_type": ["RTX4090", "A100"],
                "min_vram_gb": 12
            }
        )
        
        print("  🎨 Inference Configuration:")
        print(f"    Model: {inference_job.parameters['model_id']}")
        print(f"    Batch Size: {inference_job.parameters['batch_size']}")
        print(f"    Resolution: {inference_job.parameters['resolution']}")
        print(f"    Max Cost: {inference_job.max_cost_omc} OMC")
        
        # Submit inference job
        print("\n  🚀 Submitting AI inference job...")
        inference_job_result = await client.submit_computational_job(
            inference_job,
            from_address=wallet.address
        )
        
        print(f"  ✅ Job submitted: {inference_job_result.job_id}")
        
        # Example 3: Scientific Simulation
        print("\n🔬 Example 3: Scientific Simulation")
        simulation_job = ComputationalJobRequest(
            job_type=JobType.SCIENTIFIC_SIMULATION,
            data_source="ipfs://QmXyzAbc123.../molecular-dynamics-config.json",
            parameters={
                "simulation_type": "molecular_dynamics",
                "particle_count": 1000000,
                "time_steps": 100000,
                "temperature": 300,  # Kelvin
                "pressure": 1.0,  # atm
                "ensemble": "NPT",
                "force_field": "CHARMM36"
            },
            max_cost_omc=Decimal("15.0"),
            timeout_minutes=240,  # 4 hours
            priority=7,
            requirements={
                "min_cpu_cores": 16,
                "min_ram_gb": 64,
                "network_speed_gbps": 10,
                "storage_gb": 100
            }
        )
        
        print("  🧪 Simulation Configuration:")
        print(f"    Type: {simulation_job.parameters['simulation_type']}")
        print(f"    Particles: {simulation_job.parameters['particle_count']:,}")
        print(f"    Time Steps: {simulation_job.parameters['time_steps']:,}")
        print(f"    Max Cost: {simulation_job.max_cost_omc} OMC")
        
        # Submit simulation job
        print("\n  🚀 Submitting scientific simulation...")
        simulation_job_result = await client.submit_computational_job(
            simulation_job,
            from_address=wallet.address
        )
        
        print(f"  ✅ Job submitted: {simulation_job_result.job_id}")
        
        # Monitor job progress
        print("\n📊 Job Monitoring Example:")
        print(f"  Monitoring training job: {training_job_result.job_id}")
        
        # Simulate job monitoring (would be real in production)
        job_updates = 0
        async for job_status in client.monitor_job(training_job_result.job_id):
            job_updates += 1
            print(f"    Update #{job_updates}: {job_status.status.value} - {job_status.progress:.1f}%")
            
            if job_status.status == JobStatus.RUNNING:
                print(f"      Node: {job_status.node_id}")
                print(f"      Cost so far: {job_status.cost_omc} OMC")
            
            if job_status.status in [JobStatus.COMPLETED, JobStatus.FAILED]:
                if job_status.status == JobStatus.COMPLETED:
                    print(f"    ✅ Job completed successfully!")
                    print(f"    📊 Final cost: {job_status.cost_omc} OMC")
                    print(f"    📦 Result hash: {job_status.result_hash}")
                else:
                    print(f"    ❌ Job failed: {job_status.error_message}")
                break
            
            # Limit demo updates
            if job_updates >= 3:
                print("    ... (monitoring continues until completion)")
                break
        
        # Cost optimization tips
        print("\n💰 Cost Optimization Tips:")
        print("  🎯 Priority Management:")
        print("    - Low priority (1-3): 50-70% cost reduction, longer queue times")
        print("    - Medium priority (4-6): Standard rates, moderate queue times")
        print("    - High priority (7-10): 20-50% premium, immediate execution")
        
        print("\n  ⏰ Timing Optimization:")
        print("    - Off-peak hours: 30-50% cost reduction")
        print("    - Longer timeouts: Better node matching, lower costs")
        print("    - Flexible requirements: More node options available")
        
        print("\n  🔧 Technical Optimization:")
        print("    - Batch jobs: 20-40% cost reduction vs individual jobs")
        print("    - Efficient data formats: Reduced transfer costs")
        print("    - Incremental training: Resume from checkpoints")
        
        # Revenue sharing benefits
        print("\n🤝 Revenue Sharing Benefits:")
        print("  💰 Cross-Subsidization: Your computational job costs help reduce")
        print("     transaction fees for all Omne users (30% average reduction)")
        print("  🌍 Global Compute Network: Access to distributed computational resources")
        print("  🔒 Cryptographic Guarantees: VDP compliance ensures work verification")
        print("  ⚡ High Performance: 99.95% network availability, optimized routing")
        
        print("\n✅ AI/ML computational services example completed!")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("Make sure Omne node is running with OON features enabled")
        
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(ai_ml_services_example())
