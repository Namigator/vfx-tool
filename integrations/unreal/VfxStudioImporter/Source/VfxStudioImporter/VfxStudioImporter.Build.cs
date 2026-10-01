using UnrealBuildTool;

public class VfxStudioImporter : ModuleRules
{
	public VfxStudioImporter(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Slate",
			"SlateCore",
			"UnrealEd",
			"AssetTools",
			"AssetRegistry",
			"Niagara",
			"NiagaraCore",
			"NiagaraEditor",
			"NiagaraShader",
			"RenderCore",
			"RHI",
			"ImageWrapper",
			"MaterialEditor",
			"EditorScriptingUtilities",
			"Json",
			"JsonUtilities",
			"MeshDescription",
			"StaticMeshDescription",
		});
	}
}
